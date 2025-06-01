'use client';

import { $workbench, setWorkbenchView } from '@/app/lib/stores/workbenchStore';
import { WORK_DIR } from '@/lib/prompt';
import { Message } from '@/lib/services/conversationService';
import { getAllFilesFromWebContainer } from '@/lib/services/webContainerSync';
import { ProgressIndicator } from '@/lib/types/index';
import { TerminalActions } from '@/stores/terminal';
import { WebContainer } from '@webcontainer/api';
import he from 'he';
import { useCallback, useEffect, useRef, useState } from 'react';
import { UploadedImage } from './useImageUpload';

const BOLT_ACTION_TAG_OPEN = '<boltAction';
const BOLT_ACTION_TAG_CLOSE = '</boltAction>';

interface AIChatMessage {
	role: 'user' | 'assistant' | 'system';
	content: string | Array<{
		type: 'text' | 'image_url';
		text?: string;
		image_url?: {
			url: string;
		};
	}>;
}

interface FileExtractionState {
	accumulatedFileContent: string;
	completedFiles: Set<string>;
	lastScanLength: number;
	insideAction: boolean;
	actionType: string | null;
	actionFilePath: string | null;
	currentActionStartIndex: number;
	completedCommands: Set<string>;
}

type FileActionCallback = (filePath: string, content: string) => Promise<void>;
type DirectoryActionCallback = (dirPath: string) => Promise<void>;
type TerminalActionCallback = (command: string) => Promise<void>;

// Helper functions to handle mixed content types
const getTextContent = (content: string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>): string => {
	if (typeof content === 'string') {
		return content;
	}
	// For array content, extract text from text blocks
	return content
		.filter(item => item.type === 'text' && item.text)
		.map(item => item.text)
		.join(' ');
};
declare global {
	interface Window {
		$workbench?: {
			get: () => {
				files: Record<string, {
					type: 'file' | 'directory';
					name: string;
					content?: string;
					[key: string]: any;
				}>
			};
		};
	}
}

export const useAIChat = (
	webContainerInstance: WebContainer | null,
	_selectedFileInStore: string | null,
	setSelectedFileInEditor: (file: string | null) => void,
	runTerminalCommand?: (command: string, terminalId: string) => Promise<{ exitCode: number }>,
	terminalActions?: TerminalActions,
	initialMessagesProp?: Message[],
	conversationId?: string | null,
	selectedModel?: string,
	projectId?: string | null,
	userId?: string | null
) => {
	// Transform initialMessagesProp to AIChatMessage format
	const transformedInitialMessages: AIChatMessage[] = initialMessagesProp
		? initialMessagesProp.map(m => ({ role: m.role, content: m.content /*, id: m.id */ }))
		: [];

	const [messages, setMessages] = useState<AIChatMessage[]>(transformedInitialMessages);
	const [input, setInput] = useState('');
	const [openRouterError, setOpenRouterError] = useState<string | null>(null);
	const [streamingComplete, setStreamingComplete] = useState(true);
	const [processingFiles, setProcessingFiles] = useState(false); // Renamed for clarity

	const partialResponseForDisplayRef = useRef<string>('');
	const fullAccumulatedStreamRef = useRef<string>(''); // For action parsing

	const fileExtractionStateRef = useRef<FileExtractionState>({
		accumulatedFileContent: '', completedFiles: new Set<string>(), lastScanLength: 0,
		insideAction: false, actionType: null, actionFilePath: null, currentActionStartIndex: -1,
		completedCommands: new Set<string>(),
	});

	const [streamingData, setStreamingData] = useState<{ progressUpdates?: ProgressIndicator[]; usage?: any } | null>(null);
	const [activeFile, setActiveFile] = useState<string | null>(null);
	const [completedFilesDisplay, setCompletedFilesDisplay] = useState<Set<string>>(new Set());
	const [activeCommand, setActiveCommand] = useState<string | null>(null);
	const [completedCommandsDisplay, setCompletedCommandsDisplay] = useState<Set<string>>(new Set());
	const [isApiRequestInProgress, setIsApiRequestInProgress] = useState(false);
	const lastRequestIdRef = useRef<string>('');
	const lastProcessedMessageRef = useRef<string>('');

	const fileActionsCallbackRef = useRef<FileActionCallback | null>(null);
	const directoryActionsCallbackRef = useRef<DirectoryActionCallback | null>(null);
	const terminalActionsCallbackRef = useRef<TerminalActionCallback | null>(null);

	const setFileActionsCallback = useCallback((cb: FileActionCallback) => { fileActionsCallbackRef.current = cb; }, []);
	const setDirectoryActionsCallback = useCallback((cb: DirectoryActionCallback) => { directoryActionsCallbackRef.current = cb; }, []);
	const setTerminalActionsCallback = useCallback((cb: TerminalActionCallback) => { terminalActionsCallbackRef.current = cb; }, []);

	// Update messages when initialMessagesProp changes
	useEffect(() => {
		if (initialMessagesProp) {
			const transformed = initialMessagesProp.map(m => ({ role: m.role, content: m.content }));
			console.log(`useAIChat: Updating messages from initialMessagesProp: ${transformed.length} messages`);
			setMessages(transformed);
		}
	}, [initialMessagesProp]);

	// Auto-sync files when AI completes file operations
	const syncFilesToProject = useCallback(async () => {
		if (!webContainerInstance || !projectId || !userId) {
			console.log('Skipping file sync: missing webContainer, projectId, or userId');
			return;
		}

		try {
			const files = await getAllFilesFromWebContainer(webContainerInstance);
			if (files.length === 0) {
				console.log('No files to sync');
				return;
			}

			const response = await fetch(`/api/projects/${projectId}/sync`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ files }),
			});

			if (response.ok) {
				const result = await response.json();
			} else {
				console.error('Failed to sync files:', response.statusText);
			}
		} catch (error) {
			console.error('Error auto-syncing files:', error);
		}
	}, [webContainerInstance, projectId, userId]);


	const extractAttribute = (tag: string, name: string): string | null => {
		const patterns = [
			new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i'),
			new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i'),
			new RegExp(`${name}\\s*=\\s*([^\\s>]+)`, 'i')
		];
		for (const regex of patterns) {
			const match = tag.match(regex);
			if (match && match[1]) return he.decode(match[1].trim());
		}
		return null;
	};

	const processSpecialContent = useCallback((data: any) => {
		if (!data) return;
		try {
			if (data.type === 'progress') {
				setStreamingData((prev: any) => {
					const progressUpdates = prev?.progressUpdates || [];
					const existingIndex = progressUpdates.findIndex((p: any) => p.order === data.order && p.label === data.label);
					const updatedProgress = existingIndex >= 0
						? progressUpdates.map((p: any, i: number) => i === existingIndex ? data : p)
						: [...progressUpdates, data];
					return { ...prev, progressUpdates: updatedProgress.sort((a: any, b: any) => a.order - b.order) };
				});
			} else if (data.type === 'usage') {
				setStreamingData((prev: any) => ({ ...prev, usage: data.value }));
			}
		} catch (error) {
			console.error('Error processing special content:', error);
		}
	}, []);

	const saveAssistantMessageToDB = useCallback(async (content: string) => {
		if (!conversationId) return;
		try {
			await fetch(`/api/conversations/${conversationId}/messages`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ role: 'assistant', content }),
			});
		} catch (error) {
			console.error("Failed to save assistant message to DB:", error);
		}
	}, [conversationId]);


	const parseAndExecuteActions = useCallback(async (
		cleanContentForDisplay: string,
		isFinalParse: boolean
	) => {
		console.log(`parseAndExecuteActions called - isFinal: ${isFinalParse}, content length: ${cleanContentForDisplay.length}`);

		if (!webContainerInstance && (fileActionsCallbackRef.current || directoryActionsCallbackRef.current || terminalActionsCallbackRef.current)) {
			console.warn("parseAndExecuteActions: WebContainer instance is null, actions will be queued for later execution.");
			// We'll continue with parsing and collect actions, but won't execute them yet
		}

		const state = fileExtractionStateRef.current;
		const rawStreamForActions = fullAccumulatedStreamRef.current;
		let searchStartIndexForActions = state.lastScanLength;

		if (isFinalParse) {
			console.log("Final Parse: Resetting completedFiles and completedCommands for re-evaluation of entire stream.");
			state.completedFiles.clear();
			state.completedCommands.clear();
			searchStartIndexForActions = 0; // Always parse from beginning for final
		}

		const maxIterations = 500; // Safety break
		let iterations = 0;
		let filesCreatedOrModified = false;
		let foundBoltFileActions = false;
		let foundAnyBoltActions = false;


		while (iterations++ < maxIterations && searchStartIndexForActions < rawStreamForActions.length) {
			if (!state.insideAction) {
				const actionTagOpenIndex = rawStreamForActions.indexOf(BOLT_ACTION_TAG_OPEN, searchStartIndexForActions);
				if (actionTagOpenIndex === -1) break; // No more actions

				foundAnyBoltActions = true; // We found at least one boltAction tag

				const tagEndIndex = rawStreamForActions.indexOf('>', actionTagOpenIndex);
				if (tagEndIndex === -1) { // Incomplete open tag, wait for more data
					searchStartIndexForActions = actionTagOpenIndex;
					break;
				}

				const tagFullContent = rawStreamForActions.substring(actionTagOpenIndex, tagEndIndex + 1);
				const actionType = extractAttribute(tagFullContent, 'type');

				console.log(`🔍 Found boltAction tag: type="${actionType}", tag="${tagFullContent}"`);

				if (!actionType) {
					searchStartIndexForActions = tagEndIndex + 1;
					continue;
				}

				state.insideAction = true;
				state.actionType = actionType;
				state.currentActionStartIndex = tagEndIndex + 1; // Content starts after '>'

				if (actionType === 'file') {
					foundBoltFileActions = true; // Mark that we found an explicit file action
					let filePath = extractAttribute(tagFullContent, 'filePath') || '';
					if (!filePath) { state.insideAction = false; searchStartIndexForActions = tagEndIndex + 1; continue; }

					// Normalize the file path to prevent duplication of WORK_DIR
					// Remove leading slash if present for normalization
					let normalizedPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;

					// Check if the path already contains the work directory structure
					// Both "home/project/..." and "project/..." should be handled
					if (normalizedPath.startsWith('home/project/')) {
						// Path already has full work dir, just add leading slash
						filePath = '/' + normalizedPath;
					} else if (normalizedPath.startsWith('project/')) {
						// Path has partial work dir, prepend /home/
						filePath = '/home/' + normalizedPath;
					} else {
						// Path is relative, prepend full WORK_DIR
						if (!filePath.startsWith('/')) filePath = '/' + filePath;
						filePath = WORK_DIR + filePath;
					}

					state.actionFilePath = filePath;
					state.accumulatedFileContent = ''; // Reset for new file action
					if (!state.completedFiles.has(filePath) && !isFinalParse) {
						setActiveFile(filePath);
					}
				} else if (actionType === 'directory') {
					let dirPath = extractAttribute(tagFullContent, 'dirPath') || '';
					if (!dirPath) { state.insideAction = false; searchStartIndexForActions = tagEndIndex + 1; continue; }

					// Apply the same normalization logic for directories
					let normalizedPath = dirPath.startsWith('/') ? dirPath.substring(1) : dirPath;

					if (normalizedPath.startsWith('home/project/')) {
						// Path already has full work dir, just add leading slash
						dirPath = '/' + normalizedPath;
					} else if (normalizedPath.startsWith('project/')) {
						// Path has partial work dir, prepend /home/
						dirPath = '/home/' + normalizedPath;
					} else {
						// Path is relative, prepend full WORK_DIR
						if (!dirPath.startsWith('/')) dirPath = '/' + dirPath;
						dirPath = WORK_DIR + dirPath;
					}

					// Queue directory action if WebContainer not ready
					if (!webContainerInstance) {
						pendingActionsRef.current.directories.push(dirPath);
						console.log(`Queued directory action for later: ${dirPath}`);
						state.completedFiles.add(dirPath); // Mark as "processed" even though queued
					} else if (directoryActionsCallbackRef.current) {
						try { await directoryActionsCallbackRef.current(dirPath); } catch (e) { console.error(e); }
					}

					state.insideAction = false; // Directory action is self-closing
				} else if (actionType === 'shell' || actionType === 'command') {
					console.log(`🐚 Found shell/command action: type="${actionType}"`);
				}
				searchStartIndexForActions = tagEndIndex + 1;
			} else { // Inside an action, looking for close tag
				const actionCloseTagIndex = rawStreamForActions.indexOf(BOLT_ACTION_TAG_CLOSE, state.currentActionStartIndex);
				if (actionCloseTagIndex === -1) { // Close tag not found yet
					if (state.actionType === 'file') {
						// Append new part of raw stream that belongs to this action's content
						const newContentChunk = rawStreamForActions.substring(searchStartIndexForActions);
						state.accumulatedFileContent += newContentChunk;
					}
					searchStartIndexForActions = rawStreamForActions.length; // Processed up to end
					break;
				}

				// Close tag found, extract full action content
				let actionContentRaw = "";
				if (state.actionType === 'file') { // Content was accumulated
					actionContentRaw = state.accumulatedFileContent + rawStreamForActions.substring(state.currentActionStartIndex, actionCloseTagIndex);
				} else { // For shell/command, content is directly between open and close
					actionContentRaw = rawStreamForActions.substring(state.currentActionStartIndex, actionCloseTagIndex);
				}
				const decodedActionContent = he.decode(actionContentRaw.trim());

				console.log(`📝 Processing action: type="${state.actionType}", content="${decodedActionContent.substring(0, 100)}${decodedActionContent.length > 100 ? '...' : ''}"`);

				if (state.actionType === 'file' && state.actionFilePath) {
					const filePath = state.actionFilePath;

					// Queue file action if WebContainer not ready
					if (!webContainerInstance) {
						pendingActionsRef.current.files.push({ path: filePath, content: decodedActionContent });
						console.log(`Queued file action for later: ${filePath}`);
						state.completedFiles.add(filePath); // Mark as "processed" even though queued
						if (!isFinalParse) setActiveFile(null);
					} else if (fileActionsCallbackRef.current) {
						try {
							await fileActionsCallbackRef.current(filePath, decodedActionContent);
							filesCreatedOrModified = true; // Track that files were modified
						}
						catch (e) { console.error(`Error in file action cb for ${filePath}:`, e); }
						state.completedFiles.add(filePath);
						if (!isFinalParse) setActiveFile(null);
					}
				} else if ((state.actionType === 'shell' || state.actionType === 'command') && decodedActionContent) {
					// Queue command action if WebContainer not ready
					if (!webContainerInstance) {
						pendingActionsRef.current.commands.push(decodedActionContent);
						console.log(`⏳ Queued command for later: ${decodedActionContent}`);
						state.completedCommands.add(decodedActionContent);
						if (!isFinalParse) setActiveCommand(null);
					} else if (terminalActionsCallbackRef.current && runTerminalCommand) {
						console.log(`✅ All conditions met, executing command: "${decodedActionContent}"`);
						if (!isFinalParse) setActiveCommand(decodedActionContent);
						try {
							await terminalActionsCallbackRef.current(decodedActionContent);
						} catch (e) {
							console.error(`❌ Error executing command "${decodedActionContent}":`, e);
						}
						finally { if (!isFinalParse) setActiveCommand(null); }
						state.completedCommands.add(decodedActionContent);
					} else {
						console.warn(`⚠️ Cannot execute command "${decodedActionContent}" - missing dependencies:`, {
							webContainer: !!webContainerInstance,
							terminalCallback: !!terminalActionsCallbackRef.current,
							runTerminalCommand: !!runTerminalCommand
						});
					}
				}

				state.insideAction = false;
				state.actionType = null;
				state.actionFilePath = null;
				state.accumulatedFileContent = '';
				searchStartIndexForActions = actionCloseTagIndex + BOLT_ACTION_TAG_CLOSE.length;
				state.currentActionStartIndex = -1;
			}
		}
		state.lastScanLength = searchStartIndexForActions;

		// Fallback: If no boltAction tags were found and this is the final parse,
		// look for shell commands OR file content in markdown code blocks.
		if (isFinalParse && !foundAnyBoltActions) {
			console.log('🔄 No boltAction tags found, checking for actions in markdown code blocks...');

			const markdownCodeBlockRegex = /^\s*(?:(?:(?:\/\/|\#)\s*([a-zA-Z0-9_\-\\.\\/]+\\.[a-zA-Z0-9_]+)\s*(?:\r\n|\n|\r)\s*)?```)(?:([a-zA-Z0-9_\-\\.]+)\s*(?:\r\n|\n|\r))?([\s\S]*?)(?:\r\n|\n|\r)```/gm;
			let match;

			while ((match = markdownCodeBlockRegex.exec(cleanContentForDisplay)) !== null) {
				const pathFromCommentBeforeFences = match[1]?.trim();
				const lang = match[2]?.trim()?.toLowerCase();
				let blockContent = match[3].trim();

				let actualInferredPath = pathFromCommentBeforeFences;
				let finalContent = blockContent;

				if (!actualInferredPath && blockContent) {
					const contentLines = blockContent.split(/\r\n|\n|\r/);
					if (contentLines.length > 0) {
						const firstLine = contentLines[0].trim();
						const pathCommentInContentRegex = /^(?:\/\/|\#)\s*([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9_]+)/;
						const commentMatchInContent = firstLine.match(pathCommentInContentRegex);
						if (commentMatchInContent && commentMatchInContent[1]) {
							actualInferredPath = commentMatchInContent[1].trim();
							finalContent = contentLines.slice(1).join('\n').trim();
							console.log(`Extracted path from content's first line: ${actualInferredPath}`);
						}
					}
				}

				if (finalContent) {
					if ((lang === 'bash' || lang === 'sh' || lang === 'shell' || lang === 'zsh' || lang === 'command') && terminalActionsCallbackRef.current) {
						if (!state.completedCommands.has(finalContent)) {
							console.log(`🔄 Found shell command in markdown (lang: ${lang}): \"${finalContent}\"`);
							if (!webContainerInstance) {
								pendingActionsRef.current.commands.push(finalContent);
								console.log(`⏳ Queued fallback command for later: ${finalContent}`);
								state.completedCommands.add(finalContent);
							} else {
								try {
									await terminalActionsCallbackRef.current(finalContent);
									state.completedCommands.add(finalContent);
									console.log(`✅ Executed fallback command: \"${finalContent}\"`);
								} catch (e) {
									console.error(`❌ Error executing fallback command \"${finalContent}\":`, e);
								}
							}
						}
					} else if (actualInferredPath && fileActionsCallbackRef.current) {
						let filePath = actualInferredPath;
						let normalizedPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
						if (normalizedPath.startsWith('home/project/')) {
							filePath = '/' + normalizedPath;
						} else if (normalizedPath.startsWith('project/')) {
							filePath = '/home/' + normalizedPath;
						} else {
							if (!filePath.startsWith('/')) filePath = '/' + filePath;
							filePath = WORK_DIR + filePath;
						}

						if (!state.completedFiles.has(filePath)) {
							console.log(`🔄 Found file content in markdown (path: ${filePath}, lang: ${lang})`);
							if (!webContainerInstance) {
								pendingActionsRef.current.files.push({ path: filePath, content: finalContent });
								console.log(`Queued fallback file action for later: ${filePath}`);
								state.completedFiles.add(filePath); // Mark as "processed" even though queued
							} else {
								try {
									await fileActionsCallbackRef.current(filePath, finalContent);
									filesCreatedOrModified = true;
									state.completedFiles.add(filePath);
									console.log(`✅ Wrote fallback file: \"${filePath}\"`);
								} catch (e) {
									console.error(`❌ Error writing fallback file \"${filePath}\":`, e);
								}
							}
						}
					} else if (!foundBoltFileActions && !actualInferredPath && lang && !['bash', 'sh', 'shell', 'zsh', 'command'].includes(lang) && fileActionsCallbackRef.current) {
						console.log(`⚠️ Found code block (lang: ${lang}) in markdown without a clear file path. Content: ${finalContent.substring(0, 100)}...`);
					}
				}
			}
		}

		// Store pending actions for later execution when WebContainer becomes available
		if (!webContainerInstance && (
			pendingActionsRef.current.files.length > 0 ||
			pendingActionsRef.current.directories.length > 0 ||
			pendingActionsRef.current.commands.length > 0
		)) {
			console.log(`Stored ${pendingActionsRef.current.files.length} files, ${pendingActionsRef.current.directories.length} directories, and ${pendingActionsRef.current.commands.length} commands for later execution`);
			// We'll rely on the useEffect in the component that sees when webContainerInstance becomes available
		}

		// Update UI based on parse type
		if (isFinalParse) {
			// The cleanContentForDisplay is what user sees.
			// We no longer strip bolt tags from it for display. Let Markdown component handle it.
			const finalDisplayContent = cleanContentForDisplay.trim();
			console.log(`Final parse - updating assistant message with content (${finalDisplayContent.length} chars)`);

			setMessages(prev => {
				const updated = [...prev];
				if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
					console.log(`Updating last assistant message with final content`);
					updated[updated.length - 1].content = finalDisplayContent;
				} else {
					console.warn(`No assistant message found to update in final parse. Messages count: ${updated.length}`);
					// Add an assistant message if none exists
					updated.push({ role: 'assistant', content: finalDisplayContent });
					console.log(`Added new assistant message in final parse`);
				}
				return updated;
			});

			// Save the complete assistant message to DB
			if (finalDisplayContent) {
				await saveAssistantMessageToDB(finalDisplayContent);
			}

			// Auto-sync files if any were created or modified
			if (filesCreatedOrModified && isFinalParse) {
				console.log('Files were created/modified, triggering auto-sync');
				setTimeout(() => syncFilesToProject(), 1000); // Small delay to ensure files are written
			}

			setCompletedFilesDisplay(new Set(state.completedFiles)); // Update UI list
			setCompletedCommandsDisplay(new Set(state.completedCommands)); // Update UI list

			if (state.completedFiles.size > 0 && setSelectedFileInEditor) {
				const firstFile = Array.from(state.completedFiles)[0];
				setSelectedFileInEditor(firstFile);
				setWorkbenchView('Editor');
			}
			setActiveFile(null); // Clear active file display once final
			setActiveCommand(null); // Clear active command display

			// Reset internal tracking state for next AI message
			fileExtractionStateRef.current = {
				accumulatedFileContent: '', completedFiles: new Set<string>(), lastScanLength: 0,
				insideAction: false, actionType: null, actionFilePath: null, currentActionStartIndex: -1,
				completedCommands: new Set<string>(),
			};
			fullAccumulatedStreamRef.current = '';
		} else {
			partialResponseForDisplayRef.current = cleanContentForDisplay;
			console.log(`Incremental parse - updating assistant message with partial content (${cleanContentForDisplay.length} chars)`);

			setMessages(prev => {
				const updated = [...prev];
				if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
					updated[updated.length - 1].content = partialResponseForDisplayRef.current;
					console.log(`Updated assistant message, length: ${updated[updated.length - 1].content.length}`);
				} else {
					console.warn(`No assistant message found to update in incremental parse. Messages count: ${updated.length}`);
					// Add an assistant message if none exists
					updated.push({ role: 'assistant', content: partialResponseForDisplayRef.current });
					console.log(`Added new assistant message in incremental parse`);
				}
				return updated;
			});
			setCompletedFilesDisplay(new Set(state.completedFiles));
			setCompletedCommandsDisplay(new Set(state.completedCommands));
		}
	}, [
		webContainerInstance, setSelectedFileInEditor, setWorkbenchView,
		fileActionsCallbackRef, directoryActionsCallbackRef, terminalActionsCallbackRef,
		runTerminalCommand, saveAssistantMessageToDB, syncFilesToProject // Added syncFilesToProject
	]);

	const processSSEStream = useCallback(async (reader: ReadableStreamDefaultReader<Uint8Array>, decoder: TextDecoder) => {
		let done = false;
		let accumulatedJsonLineBuffer = ''; // Buffer for clean text for display

		// Reset display-specific accumulator for THIS stream
		partialResponseForDisplayRef.current = '';

		// DO NOT reset fullAccumulatedStreamRef or fileExtractionStateRef.lastScanLength here.
		// They are managed per AI turn, reset in sendMessageToAI / sendCurrentMessagesToLLM.

		console.log("Starting to process SSE stream from /api/chat");

		try {
			// First ensure we have an assistant message to update during streaming
			setMessages(prev => {
				// Check if the last message is already an assistant message
				if (prev.length > 0 && prev[prev.length - 1].role === 'assistant') {
					console.log("Assistant message shell already exists");
					return prev;
				}

				// If not, add an empty assistant message
				console.log("Adding assistant message shell for streaming updates");
				return [...prev, { role: 'assistant', content: '' }];
			});

			while (!done) {
				const { value, done: doneReading } = await reader.read();
				done = doneReading;

				if (done) {
					// Final parse for actions and display
					console.log("Stream done, performing final parse");
					await parseAndExecuteActions(accumulatedJsonLineBuffer, true);
					break;
				}

				if (value) {
					const rawChunk = decoder.decode(value, { stream: true });
					// Accumulate ALL raw content for action parsing
					fullAccumulatedStreamRef.current += rawChunk;

					const lines = rawChunk.split('\n');
					let newCleanTextInChunkForDisplay = '';

					for (const line of lines) {
						if (line.trim() === '') continue;

						// Check for error responses (usually line 3: contains error messages)
						if (line.startsWith('3:')) {
							try {
								const errorContent = line.substring(2);
								console.log(`Error line detected: ${errorContent}`);

								// Parse the error content - it might be JSON or plain text
								let errorMessage = errorContent;
								if (errorContent.startsWith('"') && errorContent.endsWith('"')) {
									try {
										errorMessage = JSON.parse(errorContent);
									} catch (e) {
										errorMessage = errorContent.slice(1, -1); // Remove quotes
									}
								}

								// Set the error and stop processing
								setOpenRouterError(errorMessage);
								setStreamingComplete(true);
								setProcessingFiles(false);
								setIsApiRequestInProgress(false);

								// Update the assistant message with the error
								setMessages(prev => {
									const updated = [...prev];
									if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
										updated[updated.length - 1].content = `Error: ${errorMessage}`;
									}
									return updated;
								});

								return; // Exit the function early
							} catch (e) {
								console.warn('Error parsing error line:', e, "Line:", line);
								// Fall through to treat as regular content
							}
						}

						if (line.startsWith('2:[') || line.startsWith('8:[')) { // Progress/Annotations
							try {
								console.log(`Annotation line: ${line.substring(0, 30)}...`);
								const jsonData = JSON.parse(line.substring(2));
								if (Array.isArray(jsonData)) jsonData.forEach(item => processSpecialContent(item));
							} catch (e) { console.warn('Error parsing SSE JSON line:', e, "Line:", line); }
						} else if (line.startsWith('0:')) { // Text content
							try {
								const textContent = line.substring(2);
								console.log(`Text content line: ${textContent.substring(0, 30)}...`);
								let cleanToken = textContent;

								// Handle JSON-encoded strings properly
								if (textContent.startsWith('"') && textContent.endsWith('"')) {
									try {
										cleanToken = JSON.parse(textContent); // This properly handles escaped chars like \n
									} catch (jsonError) {
										// If JSON parsing fails, fall back to manual quote removal
										cleanToken = textContent.slice(1, -1); // Remove surrounding quotes
									}
								} else if (textContent.includes('\\"') || textContent.includes('\\n')) {
									// Handle partially escaped content that might not have surrounding quotes
									try {
										cleanToken = JSON.parse(`"${textContent}"`);
									} catch (jsonError) {
										// If that fails, just use as-is
										cleanToken = textContent;
									}
								}

								// Don't decode HTML entities here as they should already be properly formatted
								// Only decode if we detect actual HTML entities (not JSON escape sequences)
								if (cleanToken.includes('&lt;') || cleanToken.includes('&gt;') || cleanToken.includes('&amp;')) {
									cleanToken = he.decode(cleanToken);
								}

								newCleanTextInChunkForDisplay += cleanToken;
							} catch (e) {
								// Fallback for any parsing errors
								const textContent = line.substring(2);
								// Remove quotes more carefully
								const cleanedContent = textContent.replace(/^["']|["']$/g, '');
								newCleanTextInChunkForDisplay += cleanedContent;
								console.warn('(Fallback) Error processing token for display:', line, e);
							}
						} else if (line.startsWith('e:') || line.startsWith('d:')) { // Usage or other data
							try {
								const dataObj = JSON.parse(line.substring(2));
								if (dataObj.usage) processSpecialContent({ type: 'usage', value: dataObj.usage });
							} catch (e) { console.warn('Error parsing usage/data line:', e, "Line:", line); }
						}
					}

					if (newCleanTextInChunkForDisplay.length > 0) {
						accumulatedJsonLineBuffer += newCleanTextInChunkForDisplay;

						// Check if the accumulated content contains error indicators
						const errorPatterns = [
							/Custom error:\s*(.*)/i,
							/Payment Required/i,
							/Insufficient credits/i,
							/API Error/i,
							/Error:\s*(.*)/i
						];

						for (const pattern of errorPatterns) {
							const match = accumulatedJsonLineBuffer.match(pattern);
							if (match) {
								const errorMessage = match[1] || match[0];
								console.log(`Error pattern detected in accumulated content: ${errorMessage}`);
								setOpenRouterError(errorMessage);
								setStreamingComplete(true);
								setProcessingFiles(false);
								setIsApiRequestInProgress(false);

								// Update the assistant message with the error
								setMessages(prev => {
									const updated = [...prev];
									if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
										updated[updated.length - 1].content = `Error: ${errorMessage}`;
									}
									return updated;
								});

								return; // Exit the function early
							}
						}
					}

					// Incremental parse for actions and update display
					// parseAndExecuteActions will handle updating the messages state for display
					await parseAndExecuteActions(accumulatedJsonLineBuffer, false);
				}
			}
		} catch (error) {
			console.error('Error processing SSE stream:', error);

			// Set the error state
			const errorMessage = error instanceof Error ? error.message : String(error);
			setOpenRouterError(errorMessage);

			// Update the assistant message with the error if no content was received
			if (accumulatedJsonLineBuffer.trim() === '') {
				setMessages(prev => {
					const updated = [...prev];
					if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
						updated[updated.length - 1].content = `Error: ${errorMessage}`;
					}
					return updated;
				});
			}

			// Attempt final parse even on error to salvage what we can
			await parseAndExecuteActions(accumulatedJsonLineBuffer, true);
		} finally {
			console.log("Stream processing complete, setting final states");
			setStreamingComplete(true);
			setProcessingFiles(false);
			setIsApiRequestInProgress(false); // CRITICAL: Release lock
			setInput(''); // Ensure input field is reset

			// Final UI updates for completed items (moved from parseAndExecuteActions final block for clarity)
			setCompletedFilesDisplay(new Set(fileExtractionStateRef.current.completedFiles));
			setCompletedCommandsDisplay(new Set(fileExtractionStateRef.current.completedCommands));

			if (fileExtractionStateRef.current.completedFiles.size > 0 && setSelectedFileInEditor) {
				const firstFile = Array.from(fileExtractionStateRef.current.completedFiles)[0];
				setSelectedFileInEditor(firstFile);
				setWorkbenchView('Editor'); // Ensure editor is visible
			}
			setActiveFile(null); // Clear active file display once final
			setActiveCommand(null);

			// Only reset accumulated stream and state references, but NOT the partialResponseForDisplayRef
			// This prevents the message content from disappearing after streaming completes
			fullAccumulatedStreamRef.current = '';
			fileExtractionStateRef.current = {
				accumulatedFileContent: '', completedFiles: new Set<string>(), lastScanLength: 0,
				insideAction: false, actionType: null, actionFilePath: null, currentActionStartIndex: -1,
				completedCommands: new Set<string>(),
			};
		}
	}, [parseAndExecuteActions, processSpecialContent, setSelectedFileInEditor, setInput]);

	const commonSendMessageSetup = () => {
		setIsApiRequestInProgress(true);
		setOpenRouterError(null);
		partialResponseForDisplayRef.current = ''; // Reset display stream - OK to clear here as we're starting a new message
		fullAccumulatedStreamRef.current = '';      // For raw action parsing stream
		fileExtractionStateRef.current = {          // Reset action parsing state
			accumulatedFileContent: '', completedFiles: new Set<string>(), lastScanLength: 0,
			insideAction: false, actionType: null, actionFilePath: null, currentActionStartIndex: -1,
			completedCommands: new Set<string>(),
		};
		setStreamingData(null);
		setProcessingFiles(true);
		setStreamingComplete(false);
		setActiveFile(null); // Reset active indicators for new stream
		setCompletedFilesDisplay(new Set());
		setActiveCommand(null);
		setCompletedCommandsDisplay(new Set());

		// Generate unique request ID
		lastRequestIdRef.current = Date.now().toString() + Math.random().toString(36).slice(2, 9);
	};

	const sendMessageToAI = useCallback(async (newMessageContent: string, images?: UploadedImage[]) => {
		// For exact duplicate messages that were successfully processed before, prevent reprocessing
		// But ALWAYS allow the first message in a conversation to be processed
		if (messages.length > 0 && lastProcessedMessageRef.current === newMessageContent.trim() && streamingComplete) {
			console.log("sendMessageToAI: Identical message already processed. To reprocess, modify the message slightly.");
			return false;
		}

		// Check for duplicate user messages from page refresh scenarios
		if (conversationId) {
			const cachedMessages = localStorage.getItem(`conversation_${conversationId}`);
			if (cachedMessages) {
				try {
					const parsedMessages = JSON.parse(cachedMessages);

					// Check if the requested message is already in our cached messages
					if (Array.isArray(parsedMessages) &&
						parsedMessages.some(m => m.role === 'user' && getTextContent(m.content) === newMessageContent.trim())) {

						// Instead of calling the API, try to find the corresponding assistant response in cache
						const userMessageIndex = parsedMessages.findIndex(m =>
							m.role === 'user' && getTextContent(m.content) === newMessageContent.trim());

						if (userMessageIndex >= 0 && userMessageIndex < parsedMessages.length - 1 &&
							parsedMessages[userMessageIndex + 1].role === 'assistant') {
							// Set the messages from cache
							setMessages(parsedMessages.slice(0, userMessageIndex + 2));
							return false;
						}
					}
				} catch (e) {
					console.warn("Error parsing cached messages:", e);
					// Continue with normal processing if there's an error
				}
			}
		}

		if (isApiRequestInProgress) {
			console.warn("sendMessageToAI: API request already in progress.");
			return false;
		}

		// Don't allow empty messages
		if (!newMessageContent.trim()) {
			console.warn("sendMessageToAI: Message empty");
			return false;
		}

		// Setup for the message (sets flags, clears state)
		commonSendMessageSetup();

		// Create the user message content based on whether we have images
		let userMessageContent: AIChatMessage['content'];

		if (images && images.length > 0) {
			userMessageContent = [
				{
					type: 'text',
					text: newMessageContent
				},
				...images.map(image => ({
					type: 'image_url' as const,
					image_url: {
						url: image.signUrl || image.url
					}
				}))
			];
		} else {
			userMessageContent = newMessageContent;
		}

		const newUserMessage: AIChatMessage = { role: 'user', content: userMessageContent };
		const emptyAssistantMessage: AIChatMessage = { role: 'assistant', content: '' };

		// Add new user message AND an empty assistant message shell for the response
		setMessages(prev => {
			// Check if we're in an unusual state with no messages
			if (prev.length === 0) {
				console.log("No messages found, adding user message and assistant shell");
				return [newUserMessage, emptyAssistantMessage];
			}

			// Check if the last message is already a user message with same content
			if (prev[prev.length - 1].role === 'user') {
				const lastUserContent = getTextContent(prev[prev.length - 1].content);
				const newUserContent = getTextContent(userMessageContent);

				if (lastUserContent === newUserContent) {
					console.log("Found duplicate user message, just adding assistant shell");
					return [...prev, emptyAssistantMessage]; // Just add the assistant message
				}
			}

			// Regular case - add both user message and assistant shell
			const updatedMessages = [...prev, newUserMessage, emptyAssistantMessage];
			return updatedMessages;
		});

		try {
			let currentWCFiles: Record<string, any> = {};
			const excludeDirs = ['/node_modules', '/.git', '/.next', '/dist', '/build', '/.cache', '/.vite', '/coverage'];

			// Skip file collection for first message if no webcontainer to speed up initial response
			if (messages.length === 0 && !webContainerInstance) {
				console.log("First message and no WebContainer, using minimal files context");
				// Still include some basic files if available
				const workbenchFiles = $workbench.get().files || {};
				for (const [path, fileObj] of Object.entries(workbenchFiles)) {
					if (excludeDirs.some(dir => path === dir || path.startsWith(dir))) continue;
					if (fileObj.type === 'file' &&
						(path.endsWith('package.json') || path.endsWith('README.md') || path.includes('src/'))) {
						currentWCFiles[path.replace(/^\//, '')] = {
							type: 'file',
							name: fileObj.name,
							content: fileObj.content || '// Content not available'
						};
					}
				}
			} else {
				// Regular file collection logic for non-first messages
				// If WebContainer is available, use its file system
				if (webContainerInstance) {
					const readDirRecursive = async (path: string) => {
						try {
							if (excludeDirs.some(dir => path === dir || path.startsWith(dir + '/'))) return;
							const entries = await webContainerInstance.fs.readdir(path, { withFileTypes: true });
							for (const entry of entries) {
								const entryPath = `${path === '/' ? '' : path}/${entry.name}`;
								if (excludeDirs.some(dir => entryPath === dir || entryPath.startsWith(dir + '/'))) continue;
								if (entry.isFile()) {
									// Make sure to read file content and include it
									try {
										const content = await webContainerInstance.fs.readFile(entryPath, 'utf-8');
										currentWCFiles[entryPath.replace(/^\//, '')] = {
											type: 'file',
											name: entry.name,
											content: content
										};
									} catch (err) {
										console.warn(`Could not read file content for ${entryPath}:`, err);
										currentWCFiles[entryPath.replace(/^\//, '')] = {
											type: 'file',
											name: entry.name,
											content: '// File content not available'
										};
									}
								} else if (entry.isDirectory()) {
									currentWCFiles[entryPath.replace(/^\//, '')] = { type: 'directory', name: entry.name };
									await readDirRecursive(entryPath);
								}
							}
						} catch (e) { console.warn(`Could not read dir ${path} for AI context:`, e); }
					};
					await readDirRecursive('/');
					console.log(`Using WebContainer files for context (${Object.keys(currentWCFiles).length} files)`);
				} else {
					// If WebContainer is not available, try to use workbench files from the store
					try {
						// Try getting files from imported store first, then fall back to window global
						const workbenchFiles = $workbench.get().files || {};

						if (Object.keys(workbenchFiles).length > 0) {
							console.log(`Using workbench files from store for context (${Object.keys(workbenchFiles).length} files)`);

							// Convert workbench files to the format expected by the API
							for (const [path, fileObj] of Object.entries(workbenchFiles)) {
								// Skip directories in excludeDirs
								if (excludeDirs.some(dir => path === dir || path.startsWith(dir))) continue;

								if (fileObj.type === 'file') {
									currentWCFiles[path.replace(/^\//, '')] = {
										type: 'file',
										name: fileObj.name,
										content: fileObj.content || '// Content not available'
									};
								} else if (fileObj.type === 'directory') {
									currentWCFiles[path.replace(/^\//, '')] = {
										type: 'directory',
										name: fileObj.name
									};
								}
							}
						} else {
							// Fall back to window global as a last resort
							console.log('No files in store, trying window.$workbench');
							const windowWorkbenchStore = typeof window !== 'undefined' && window.$workbench
								? window.$workbench
								: null;

							if (windowWorkbenchStore) {
								const windowWorkbenchFiles = windowWorkbenchStore.get().files || {};

								if (Object.keys(windowWorkbenchFiles).length > 0) {
									console.log(`Using workbench files from window global for context (${Object.keys(windowWorkbenchFiles).length} files)`);
									// Convert workbench files to the format expected by the API
									for (const [path, fileObj] of Object.entries(windowWorkbenchFiles)) {
										// Skip directories in excludeDirs
										if (excludeDirs.some(dir => path === dir || path.startsWith(dir))) continue;

										if (fileObj.type === 'file') {
											currentWCFiles[path.replace(/^\//, '')] = {
												type: 'file',
												name: fileObj.name,
												content: fileObj.content || '// Content not available'
											};
										} else if (fileObj.type === 'directory') {
											currentWCFiles[path.replace(/^\//, '')] = {
												type: 'directory',
												name: fileObj.name
											};
										}
									}
								} else {
									console.warn("No files available from workbench for context");
								}
							} else {
								console.warn("Workbench store not accessible via window global");
							}
						}
					} catch (e) {
						console.warn("Error accessing workbench files:", e);
					}
				}
			}

			// Make a copy to avoid including the assistant message shell we added
			const messagesForPayload = [...messages].filter(m => m.role !== 'assistant' || getTextContent(m.content).trim() !== '');
			// Add the new user message if it's not already included
			if (!messagesForPayload.some(m => m.role === 'user' && getTextContent(m.content) === newMessageContent)) {
				messagesForPayload.push(newUserMessage);
			}

			// Map to the format expected by the API
			const formattedMessages = messagesForPayload.map(m => ({ role: m.role, content: m.content }));

			const requestPayload = {
				messages: formattedMessages,
				files: currentWCFiles,
				promptId: 'default',
				contextOptimization: true,
				conversationId: conversationId,
				selectedModel: selectedModel
			};

			const response = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(requestPayload),
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`HTTP error! Status: ${response.status} - ${errorText}`);
			}
			if (!response.body) throw new Error('Response body is null');

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			await processSSEStream(reader, decoder);

			// Only mark as processed if successful
			lastProcessedMessageRef.current = newMessageContent.trim();
			return true;

		} catch (error: any) {
			console.error('Error in sendMessageToAI:', error);
			const errorMessage = error.message || 'Unknown error';
			setOpenRouterError(errorMessage);
			setMessages(prev => {
				const updated = [...prev];
				if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
					updated[updated.length - 1].content = `Error: ${errorMessage}`;
				}
				return updated;
			});
			setIsApiRequestInProgress(false); // Release lock on error
			setStreamingComplete(true);      // Ensure streaming is marked complete
			setProcessingFiles(false);
			return false;
		}
	}, [
		messages, webContainerInstance, processSSEStream, isApiRequestInProgress, conversationId, streamingComplete, selectedModel
	]);

	const sendCurrentMessagesToLLM = useCallback(async () => {
		if (isApiRequestInProgress) { console.warn("sendCurrentMessagesToLLM: API request already in progress."); return false; }

		// Use initialMessagesProp as fallback if messages state hasn't been updated yet
		const messagesToUse = messages.length > 0 ? messages : (initialMessagesProp || []);

		if (messagesToUse.length === 0) { console.warn("sendCurrentMessagesToLLM: No messages available"); return false; }

		// Convert initialMessagesProp to AIChatMessage format if using it
		const formattedMessagesToUse = messagesToUse.length > 0 && messagesToUse[0].role
			? messagesToUse.map(m => ({ role: m.role, content: m.content }))
			: messagesToUse;

		if (formattedMessagesToUse[formattedMessagesToUse.length - 1].role !== 'user') {
			console.warn("sendCurrentMessagesToLLM: Last message not from user.");
			return false;
		}

		// Check if this is a page refresh with an existing conversation
		if (conversationId && formattedMessagesToUse.length >= 2) {
			const lastUserMessage = formattedMessagesToUse.filter(m => m.role === 'user').pop();
			const cachedMessages = localStorage.getItem(`conversation_${conversationId}`);

			if (cachedMessages) {
				try {
					const parsedMessages = JSON.parse(cachedMessages);
					// Check if the requested message is already in our cached messages
					if (Array.isArray(parsedMessages) &&
						lastUserMessage &&
						parsedMessages.some(m => m.role === 'user' && getTextContent(m.content) === getTextContent(lastUserMessage.content))) {

						return false;
					}
				} catch (e) {
					console.warn("Error parsing cached messages:", e);
					// Continue with normal processing if there's an error
				}
			}
		}

		// Save the current conversation to localStorage for refresh detection
		if (conversationId && formattedMessagesToUse.length > 0) {
			try {
				localStorage.setItem(`conversation_${conversationId}`, JSON.stringify(formattedMessagesToUse));
			} catch (e) {
				console.warn("Error saving conversation to localStorage:", e);
			}
		}

		// Update messages state if we're using initialMessagesProp
		if (messages.length === 0 && formattedMessagesToUse.length > 0) {
			console.log("Updating messages state from initialMessagesProp before API call");
			setMessages(formattedMessagesToUse);
		}

		commonSendMessageSetup();
		const currentRequestId = lastRequestIdRef.current;

		// Use the content of the last user message for duplicate detection
		const lastUserMessage = formattedMessagesToUse[formattedMessagesToUse.length - 1];

		// Only check for duplicates if we've already successfully processed this exact message
		if (lastProcessedMessageRef.current === getTextContent(lastUserMessage.content).trim() && streamingComplete) {
			console.log("sendCurrentMessagesToLLM: Identical message already processed");
			setIsApiRequestInProgress(false);
			return false;
		}

		// Add an empty assistant message shell for the upcoming response
		setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

		try {
			let currentWCFiles: Record<string, any> = {};
			const excludeDirs = ['/node_modules', '/.git', '/.next', '/dist', '/build', '/.cache', '/.vite', '/coverage'];

			// Skip file collection for first message if no webcontainer to speed up initial response
			if (formattedMessagesToUse.length === 1 && !webContainerInstance) {
				console.log("First message and no WebContainer, using minimal files context");
				// Still include some basic files if available
				const workbenchFiles = $workbench.get().files || {};
				for (const [path, fileObj] of Object.entries(workbenchFiles)) {
					if (excludeDirs.some(dir => path === dir || path.startsWith(dir))) continue;
					if (fileObj.type === 'file' &&
						(path.endsWith('package.json') || path.endsWith('README.md') || path.includes('src/'))) {
						currentWCFiles[path.replace(/^\//, '')] = {
							type: 'file',
							name: fileObj.name,
							content: fileObj.content || '// Content not available'
						};
					}
				}
			} else {
				// Regular file collection logic for non-first messages
				// If WebContainer is available, use its file system
				if (webContainerInstance) {
					const readDirRecursive = async (path: string) => {
						try {
							if (excludeDirs.some(dir => path === dir || path.startsWith(dir + '/'))) return;
							const entries = await webContainerInstance.fs.readdir(path, { withFileTypes: true });
							for (const entry of entries) {
								const entryPath = `${path === '/' ? '' : path}/${entry.name}`;
								if (excludeDirs.some(dir => entryPath === dir || entryPath.startsWith(dir + '/'))) continue;
								if (entry.isFile()) {
									// Make sure to read file content and include it
									try {
										const content = await webContainerInstance.fs.readFile(entryPath, 'utf-8');
										currentWCFiles[entryPath.replace(/^\//, '')] = {
											type: 'file',
											name: entry.name,
											content: content
										};
									} catch (err) {
										console.warn(`Could not read file content for ${entryPath}:`, err);
										currentWCFiles[entryPath.replace(/^\//, '')] = {
											type: 'file',
											name: entry.name,
											content: '// File content not available'
										};
									}
								} else if (entry.isDirectory()) {
									currentWCFiles[entryPath.replace(/^\//, '')] = { type: 'directory', name: entry.name };
									await readDirRecursive(entryPath);
								}
							}
						} catch (e) { console.warn(`Could not read dir ${path} for AI context:`, e); }
					};
					await readDirRecursive('/');
					console.log(`Using WebContainer files for context (${Object.keys(currentWCFiles).length} files)`);
				} else {
					// If WebContainer is not available, try to use workbench files from the store
					try {
						// Try getting files from imported store first, then fall back to window global
						const workbenchFiles = $workbench.get().files || {};

						if (Object.keys(workbenchFiles).length > 0) {
							console.log(`Using workbench files from store for context (${Object.keys(workbenchFiles).length} files)`);

							// Convert workbench files to the format expected by the API
							for (const [path, fileObj] of Object.entries(workbenchFiles)) {
								// Skip directories in excludeDirs
								if (excludeDirs.some(dir => path === dir || path.startsWith(dir))) continue;

								if (fileObj.type === 'file') {
									currentWCFiles[path.replace(/^\//, '')] = {
										type: 'file',
										name: fileObj.name,
										content: fileObj.content || '// Content not available'
									};
								} else if (fileObj.type === 'directory') {
									currentWCFiles[path.replace(/^\//, '')] = {
										type: 'directory',
										name: fileObj.name
									};
								}
							}
						} else {
							// Fall back to window global as a last resort
							console.log('No files in store, trying window.$workbench');
							const windowWorkbenchStore = typeof window !== 'undefined' && window.$workbench
								? window.$workbench
								: null;

							if (windowWorkbenchStore) {
								const windowWorkbenchFiles = windowWorkbenchStore.get().files || {};

								if (Object.keys(windowWorkbenchFiles).length > 0) {
									console.log(`Using workbench files from window global for context (${Object.keys(windowWorkbenchFiles).length} files)`);
									// Convert workbench files to the format expected by the API
									for (const [path, fileObj] of Object.entries(windowWorkbenchFiles)) {
										// Skip directories in excludeDirs
										if (excludeDirs.some(dir => path === dir || path.startsWith(dir))) continue;

										if (fileObj.type === 'file') {
											currentWCFiles[path.replace(/^\//, '')] = {
												type: 'file',
												name: fileObj.name,
												content: fileObj.content || '// Content not available'
											};
										} else if (fileObj.type === 'directory') {
											currentWCFiles[path.replace(/^\//, '')] = {
												type: 'directory',
												name: fileObj.name
											};
										}
									}
								} else {
									console.warn("No files available from workbench for context");
								}
							} else {
								console.warn("Workbench store not accessible via window global");
							}
						}
					} catch (e) {
						console.warn("Error accessing workbench files:", e);
					}
				}
			}

			// Check if this request has been superseded
			if (currentRequestId !== lastRequestIdRef.current) {
				console.warn("Request superseded while collecting files. Aborting.");
				setIsApiRequestInProgress(false);
				return false;
			}

			// Use formattedMessagesToUse, but filter out empty assistant messages
			const messagesForPayload = formattedMessagesToUse.filter(m => m.role !== 'assistant' || getTextContent(m.content).trim() !== '');

			// Map to the format expected by the API
			const formattedMessages = messagesForPayload.map(m => ({ role: m.role, content: m.content }));

			console.log(`Sending messages with ${Object.keys(currentWCFiles).length} files in context`);
			console.log(`API payload contains ${formattedMessages.length} messages`);

			const requestPayload = {
				messages: formattedMessages,
				files: currentWCFiles,
				promptId: 'default',
				contextOptimization: true,
				conversationId: conversationId, // Add conversationId
				selectedModel: selectedModel
			};

			const response = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(requestPayload),
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`HTTP error! Status: ${response.status} - ${errorText}`);
			}
			if (!response.body) throw new Error('Response body is null');

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			await processSSEStream(reader, decoder);

			// Only mark as processed if successful
			lastProcessedMessageRef.current = getTextContent(lastUserMessage.content).trim();
			return true;

		} catch (error: any) {
			console.error('Error in sendCurrentMessagesToLLM:', error);
			const errorMessage = error.message || 'Unknown error';
			setOpenRouterError(errorMessage);
			setMessages(prev => {
				const updated = [...prev];
				if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
					updated[updated.length - 1].content = `Error: ${errorMessage}`;
				}
				return updated;
			});
			setIsApiRequestInProgress(false); // Release lock on error
			setStreamingComplete(true);      // Ensure streaming is marked complete
			setProcessingFiles(false);
			return false;
		}
	}, [
		messages, initialMessagesProp, webContainerInstance, processSSEStream, isApiRequestInProgress, conversationId, streamingComplete, selectedModel
	]);

	const stopStreaming = useCallback(() => {
		// This is a simplified stop. True abortion of fetch requires AbortController.
		// For now, this primarily updates client-side state.
		console.log("Attempting to stop streaming (client-side state update)...");
		setStreamingComplete(true);
		setProcessingFiles(false);
		setIsApiRequestInProgress(false);
		setActiveFile(null);
		setActiveCommand(null);
	}, []);

	// Add this before the return statement in useAIChat
	// Ref to store pending actions for execution when WebContainer becomes available
	const pendingActionsRef = useRef<{
		files: Array<{ path: string, content: string }>;
		directories: Array<string>;
		commands: Array<string>;
	}>({
		files: [],
		directories: [],
		commands: []
	});

	// Add a useEffect to execute pending actions when WebContainer becomes available
	useEffect(() => {
		// Only run if WebContainer instance becomes available and we have pending actions
		if (!webContainerInstance ||
			(!pendingActionsRef.current.files.length &&
				!pendingActionsRef.current.directories.length &&
				!pendingActionsRef.current.commands.length)) {
			return;
		}

		const executePendingActions = async () => {
			console.log(`WebContainer is now available. Executing ${pendingActionsRef.current.files.length} pending file actions, ${pendingActionsRef.current.directories.length} directory actions, and ${pendingActionsRef.current.commands.length} commands.`);

			// First create directories
			if (pendingActionsRef.current.directories.length > 0 && directoryActionsCallbackRef.current) {
				for (const dirPath of pendingActionsRef.current.directories) {
					try {
						await directoryActionsCallbackRef.current(dirPath);
						console.log(`Executed pending directory action: ${dirPath}`);
					} catch (e) {
						console.error(`Error executing pending directory action for ${dirPath}:`, e);
					}
				}
				pendingActionsRef.current.directories = [];
			}

			// Then create files
			if (pendingActionsRef.current.files.length > 0 && fileActionsCallbackRef.current) {
				for (const { path, content } of pendingActionsRef.current.files) {
					try {
						await fileActionsCallbackRef.current(path, content);
						console.log(`Executed pending file action: ${path}`);
					} catch (e) {
						console.error(`Error executing pending file action for ${path}:`, e);
					}
				}

				// If we successfully created files, select the first one
				if (pendingActionsRef.current.files.length > 0 && setSelectedFileInEditor) {
					const firstFile = pendingActionsRef.current.files[0].path;
					setSelectedFileInEditor(firstFile);
					setWorkbenchView('Editor');
				}

				pendingActionsRef.current.files = [];

				// Auto-sync files after executing pending actions
				if (projectId && userId) {
					console.log('Pending file actions executed, triggering auto-sync');
					setTimeout(() => syncFilesToProject(), 1000);
				}
			}

			// Finally run commands
			if (pendingActionsRef.current.commands.length > 0 && terminalActionsCallbackRef.current) {
				for (const command of pendingActionsRef.current.commands) {
					try {
						await terminalActionsCallbackRef.current(command);
						console.log(`Executed pending command: ${command}`);
					} catch (e) {
						console.error(`Error executing pending command: ${command}`, e);
					}
				}
				pendingActionsRef.current.commands = [];
			}
		};

		executePendingActions();
	}, [webContainerInstance, fileActionsCallbackRef, directoryActionsCallbackRef, terminalActionsCallbackRef, setSelectedFileInEditor, syncFilesToProject, projectId, userId]);

	return {
		messages, setMessages, input, setInput, openRouterError,
		sendMessageToAI, sendCurrentMessagesToLLM, stopStreaming,
		processingFiles, streamingComplete,
		activeFile, completedFiles: completedFilesDisplay,
		activeCommand, completedCommands: completedCommandsDisplay,
		streamingData,
		setFileActionsCallback, setDirectoryActionsCallback, setTerminalActionsCallback,
	};
};
