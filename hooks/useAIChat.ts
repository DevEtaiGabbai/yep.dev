'use client';

import { $workbench, clearStreamingContent, setWorkbenchView, updateStreamingContent } from '@/app/lib/stores/workbenchStore';
import { getAllApiKeysFromStorage } from '@/lib/api-keys';
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

const getTextContent = (content: string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>): string => {
	if (typeof content === 'string') {
		return content;
	}
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
	const transformedInitialMessages: AIChatMessage[] = initialMessagesProp
		? initialMessagesProp.map(m => ({ role: m.role, content: m.content }))
		: [];

	const [messages, setMessages] = useState<AIChatMessage[]>(transformedInitialMessages);
	const [input, setInput] = useState('');
	const [openRouterError, setOpenRouterError] = useState<string | null>(null);
	const [streamingComplete, setStreamingComplete] = useState(true);
	const [processingFiles, setProcessingFiles] = useState(false);

	const partialResponseForDisplayRef = useRef<string>('');
	const fullAccumulatedStreamRef = useRef<string>('');

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

	useEffect(() => {
		if (initialMessagesProp) {
			const transformed = initialMessagesProp.map(m => ({ role: m.role, content: m.content }));
			setMessages(transformed);
		}
	}, [initialMessagesProp]);

	const syncFilesToProject = useCallback(async () => {
		if (!webContainerInstance || !projectId || !userId) {
			return;
		}

		try {
			const files = await getAllFilesFromWebContainer(webContainerInstance);
			if (files.length === 0) {
				return;
			}

			const response = await fetch(`/api/projects/${projectId}/sync`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ files }),
			});

			if (!response.ok) {
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

	const normalizeFilePath = useCallback((filePath: string): string => {
		let normalizedPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;

		if (normalizedPath.startsWith('home/project/')) {
			return '/' + normalizedPath;
		} else if (normalizedPath.startsWith('project/')) {
			return '/home/' + normalizedPath;
		} else {
			if (!filePath.startsWith('/')) filePath = '/' + filePath;
			return WORK_DIR + filePath;
		}
	}, []);

	const parseStreamContent = useCallback(async (
		rawContent: string,
		isFinalParse: boolean
	): Promise<string> => {
		const state = fileExtractionStateRef.current;
		let searchStartIndex = isFinalParse ? 0 : state.lastScanLength;

		// Extract narrative content first (before bolt tags)
		let narrativeContent = '';
		const firstBoltMatch = rawContent.match(/<bolt[A-Z]/);
		if (firstBoltMatch && firstBoltMatch.index > 0) {
			narrativeContent = rawContent.substring(0, firstBoltMatch.index).trim();
		}

		if (!narrativeContent && rawContent.includes('<boltArtifact')) {
			const titleMatch = rawContent.match(/<boltArtifact\s+[^>]*title="([^"]+)"/);
			if (titleMatch) {
				narrativeContent = titleMatch[1];
			}
		}

		if (!narrativeContent) {
			const incompleteBoltRegex = /<bolt[^>]*[\s\S]*$/;
			const incompleteMatch = rawContent.match(incompleteBoltRegex);
			if (incompleteMatch && incompleteMatch.index > 0) {
				narrativeContent = rawContent.substring(0, incompleteMatch.index).trim();
			}
		}

		// If still no narrative, extract from actions for display
		if (!narrativeContent && (rawContent.includes('<boltAction') || rawContent.includes('<boltArtifact'))) {
			const fileActions = [];
			const fileActionRegex = /<boltAction\s+type="file"\s+filePath="([^"]+)"/g;
			let match;
			while ((match = fileActionRegex.exec(rawContent)) !== null) {
				const filePath = match[1].split('/').pop() || match[1];
				fileActions.push(filePath);
			}

			if (fileActions.length > 0) {
				if (fileActions.length === 1) {
					narrativeContent = `Created ${fileActions[0]}`;
				} else {
					const lastFile = fileActions.pop();
					narrativeContent = `Created ${fileActions.join(', ')} and ${lastFile}`;
				}
			} else {
				narrativeContent = "Processing...";
			}
		}

		// Fallback narrative content
		if (!narrativeContent) {
			narrativeContent = rawContent
				.replace(/<boltArtifact\s+[^>]*>[\s\S]*?<\/boltArtifact>/g, '')
				.replace(/<boltAction\s+[^>]*>[\s\S]*?<\/boltAction>/g, '')
				.replace(/<bolt[^>]*[\s\S]*$/, '')
				.trim();
		}

		// Reset state for final parse
		if (isFinalParse) {
			state.completedFiles.clear();
			state.completedCommands.clear();
			searchStartIndex = 0;
		}

		// Process actions
		const maxIterations = 500;
		let iterations = 0;
		let filesCreatedOrModified = false;
		let foundBoltActions = false;

		while (iterations++ < maxIterations && searchStartIndex < rawContent.length) {
			if (!state.insideAction) {
				const actionTagOpenIndex = rawContent.indexOf(BOLT_ACTION_TAG_OPEN, searchStartIndex);
				if (actionTagOpenIndex === -1) break;

				foundBoltActions = true;

				const tagEndIndex = rawContent.indexOf('>', actionTagOpenIndex);
				if (tagEndIndex === -1) {
					searchStartIndex = actionTagOpenIndex;
					break;
				}

				const tagFullContent = rawContent.substring(actionTagOpenIndex, tagEndIndex + 1);
				const actionType = extractAttribute(tagFullContent, 'type');

				if (!actionType) {
					searchStartIndex = tagEndIndex + 1;
					continue;
				}

				state.insideAction = true;
				state.actionType = actionType;
				state.currentActionStartIndex = tagEndIndex + 1;

				if (actionType === 'file') {
					let filePath = extractAttribute(tagFullContent, 'filePath') || '';
					if (!filePath) {
						state.insideAction = false;
						searchStartIndex = tagEndIndex + 1;
						continue;
					}

					filePath = normalizeFilePath(filePath);
					state.actionFilePath = filePath;
					state.accumulatedFileContent = '';

					if (!state.completedFiles.has(filePath) && !isFinalParse) {
						setActiveFile(filePath);
					}
				} else if (actionType === 'directory') {
					let dirPath = extractAttribute(tagFullContent, 'dirPath') || '';
					if (!dirPath) {
						state.insideAction = false;
						searchStartIndex = tagEndIndex + 1;
						continue;
					}

					dirPath = normalizeFilePath(dirPath);

					if (!webContainerInstance) {
						pendingActionsRef.current.directories.push(dirPath);
						state.completedFiles.add(dirPath);
					} else if (directoryActionsCallbackRef.current) {
						try {
							await directoryActionsCallbackRef.current(dirPath);
						} catch (e) {
							console.error(e);
						}
					}

					state.insideAction = false;
				}
				searchStartIndex = tagEndIndex + 1;
			} else {
				const actionCloseTagIndex = rawContent.indexOf(BOLT_ACTION_TAG_CLOSE, state.currentActionStartIndex);
				if (actionCloseTagIndex === -1) {
					if (state.actionType === 'file') {
						const newContentChunk = rawContent.substring(searchStartIndex);
						state.accumulatedFileContent += newContentChunk;

						if (state.actionFilePath && !isFinalParse) {
							const decodedStreamingContent = he.decode(state.accumulatedFileContent);
							updateStreamingContent(state.actionFilePath, decodedStreamingContent);
						}
					}
					searchStartIndex = rawContent.length;
					break;
				}

				let actionContentRaw = "";
				if (state.actionType === 'file') {
					actionContentRaw = state.accumulatedFileContent + rawContent.substring(state.currentActionStartIndex, actionCloseTagIndex);
				} else {
					actionContentRaw = rawContent.substring(state.currentActionStartIndex, actionCloseTagIndex);
				}
				const decodedActionContent = he.decode(actionContentRaw.trim());

				if (state.actionType === 'file' && state.actionFilePath) {
					const filePath = state.actionFilePath;

					if (!webContainerInstance) {
						pendingActionsRef.current.files.push({ path: filePath, content: decodedActionContent });
						state.completedFiles.add(filePath);
						if (!isFinalParse) {
							setActiveFile(null);
							setCompletedFilesDisplay(prev => new Set([...prev, filePath]));
						}
					} else if (fileActionsCallbackRef.current) {
						try {
							await fileActionsCallbackRef.current(filePath, decodedActionContent);
							filesCreatedOrModified = true;
						}
						catch (e) {
							console.error(`Error in file action for ${filePath}:`, e);
						}
						state.completedFiles.add(filePath);
						if (!isFinalParse) {
							setActiveFile(null);
							setCompletedFilesDisplay(prev => new Set([...prev, filePath]));
						}
					}

					if (!isFinalParse) {
						clearStreamingContent();
					}
				} else if ((state.actionType === 'shell' || state.actionType === 'command') && decodedActionContent) {
					if (!webContainerInstance) {
						pendingActionsRef.current.commands.push(decodedActionContent);
						state.completedCommands.add(decodedActionContent);
						if (!isFinalParse) {
							setActiveCommand(null);
							setCompletedCommandsDisplay(prev => new Set([...prev, decodedActionContent]));
						}
					} else if (terminalActionsCallbackRef.current && runTerminalCommand) {
						if (!isFinalParse) setActiveCommand(decodedActionContent);
						try {
							await terminalActionsCallbackRef.current(decodedActionContent);
						} catch (e) {
							console.error(`Error executing command "${decodedActionContent}":`, e);
						}
						finally {
							if (!isFinalParse) {
								setActiveCommand(null);
								setCompletedCommandsDisplay(prev => new Set([...prev, decodedActionContent]));
							}
						}
						state.completedCommands.add(decodedActionContent);
					}
				}

				state.insideAction = false;
				state.actionType = null;
				state.actionFilePath = null;
				state.accumulatedFileContent = '';
				searchStartIndex = actionCloseTagIndex + BOLT_ACTION_TAG_CLOSE.length;
				state.currentActionStartIndex = -1;
			}
		}
		state.lastScanLength = searchStartIndex;

		// Handle fallback markdown code blocks only on final parse if no bolt actions found
		if (isFinalParse && !foundBoltActions) {
			const markdownCodeBlockRegex = /^\s*(?:(?:(?:\/\/|\#)\s*([a-zA-Z0-9_\-\\.\\/]+\\.[a-zA-Z0-9_]+)\s*(?:\r\n|\n|\r)\s*)?```)(?:([a-zA-Z0-9_\-\\.]+)\s*(?:\r\n|\n|\r))?([\s\S]*?)(?:\r\n|\n|\r)```/gm;
			let match;

			while ((match = markdownCodeBlockRegex.exec(rawContent)) !== null) {
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
						}
					}
				}

				if (finalContent) {
					if ((lang === 'bash' || lang === 'sh' || lang === 'shell' || lang === 'zsh' || lang === 'command') && terminalActionsCallbackRef.current) {
						if (!state.completedCommands.has(finalContent)) {
							if (!webContainerInstance) {
								pendingActionsRef.current.commands.push(finalContent);
								state.completedCommands.add(finalContent);
							} else {
								try {
									await terminalActionsCallbackRef.current(finalContent);
									state.completedCommands.add(finalContent);
								} catch (e) {
									console.error(`Error executing fallback command "${finalContent}":`, e);
								}
							}
						}
					} else if (actualInferredPath && fileActionsCallbackRef.current) {
						let filePath = normalizeFilePath(actualInferredPath);

						if (!state.completedFiles.has(filePath)) {
							if (!webContainerInstance) {
								pendingActionsRef.current.files.push({ path: filePath, content: finalContent });
								state.completedFiles.add(filePath);
							} else {
								try {
									await fileActionsCallbackRef.current(filePath, finalContent);
									filesCreatedOrModified = true;
									state.completedFiles.add(filePath);
								} catch (e) {
									console.error(`Error writing fallback file "${filePath}":`, e);
								}
							}
						}
					}
				}
			}
		}

		// Handle final parse completion
		if (isFinalParse) {
			let contentForDB = narrativeContent;

			if (state.completedFiles.size > 0) {
				const fileMessages = Array.from(state.completedFiles).map(filePath => {
					const relativePath = filePath.replace(/^\/home\/project\//, '').replace(/^\//, '');
					return `[Updated ${relativePath}](file://${filePath})`;
				});

				if (contentForDB) {
					contentForDB = contentForDB + '\n\n' + fileMessages.join('\n');
				} else {
					contentForDB = fileMessages.join('\n');
				}
			}

			if (contentForDB) {
				await saveAssistantMessageToDB(contentForDB);
			}

			// Sync files to project
			if (filesCreatedOrModified && isFinalParse) {
				setTimeout(() => syncFilesToProject(), 1000);
			}

			// Update display state
			setCompletedFilesDisplay(new Set(state.completedFiles));
			setCompletedCommandsDisplay(new Set(state.completedCommands));

			// Select first file for editing
			if (state.completedFiles.size > 0 && setSelectedFileInEditor) {
				const firstFile = Array.from(state.completedFiles)[0];
				setSelectedFileInEditor(firstFile);
				setWorkbenchView('Editor');
			}
			setActiveFile(null);
			setActiveCommand(null);

			// Return content with file links for display
			const fileMessages = Array.from(state.completedFiles).map(filePath => {
				const relativePath = filePath.replace(/^\/home\/project\//, '').replace(/^\//, '');
				return `[Updated ${relativePath}](file://${filePath})`;
			});

			if (narrativeContent && fileMessages.length > 0) {
				return narrativeContent + '\n\n' + fileMessages.join('\n');
			} else if (fileMessages.length > 0) {
				return fileMessages.join('\n');
			}
		}

		return narrativeContent;
	}, [
		webContainerInstance, setSelectedFileInEditor, setWorkbenchView,
		fileActionsCallbackRef, directoryActionsCallbackRef, terminalActionsCallbackRef,
		runTerminalCommand, saveAssistantMessageToDB, syncFilesToProject, normalizeFilePath,
		extractAttribute
	]);

	const processSSEStream = useCallback(async (reader: ReadableStreamDefaultReader<Uint8Array>, decoder: TextDecoder) => {
		let done = false;
		let accumulatedJsonLineBuffer = '';
		partialResponseForDisplayRef.current = '';

		try {
			while (!done) {
				const { value, done: doneReading } = await reader.read();
				done = doneReading;

				if (done) {
					const finalDisplayContent = await parseStreamContent(accumulatedJsonLineBuffer, true);
					console.log(`[processSSEStream] Final display content:`, finalDisplayContent);

					if (finalDisplayContent) {
						setMessages(prev => {
							const updated = [...prev];
							if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
								updated[updated.length - 1].content = finalDisplayContent;
								console.log(`Updated final assistant message with complete content, length: ${finalDisplayContent.length}`);
							}
							return updated;
						});
					}

					break;
				}

				if (value) {
					const rawChunk = decoder.decode(value, { stream: true });
					fullAccumulatedStreamRef.current += rawChunk;

					const lines = rawChunk.split('\n');
					let newCleanTextInChunkForDisplay = '';

					for (const line of lines) {
						if (line.trim() === '') continue;

						if (line.startsWith('3:')) {
							try {
								const errorContent = line.substring(2);
								console.log(`Error line detected: ${errorContent}`);

								let errorMessage = errorContent;
								if (errorContent.startsWith('"') && errorContent.endsWith('"')) {
									try {
										errorMessage = JSON.parse(errorContent);
									} catch (e) {
										errorMessage = errorContent.slice(1, -1);
									}
								}

								setOpenRouterError(errorMessage);
								setStreamingComplete(true);
								setProcessingFiles(false);
								setIsApiRequestInProgress(false);

								setMessages(prev => {
									const updated = [...prev];
									if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
										updated[updated.length - 1].content = `Error: ${errorMessage}`;
									}
									return updated;
								});

								return;
							} catch (e) {
								console.warn('Error parsing error line:', e, "Line:", line);
							}
						}

						if (line.startsWith('2:[') || line.startsWith('8:[')) {
							try {
								const jsonData = JSON.parse(line.substring(2));
								if (Array.isArray(jsonData)) jsonData.forEach(item => processSpecialContent(item));
							} catch (e) { console.warn('Error parsing SSE JSON line:', e, "Line:", line); }
						} else if (line.startsWith('0:')) {
							try {
								const textContent = line.substring(2);
								let cleanToken = textContent;

								if (textContent.startsWith('"') && textContent.endsWith('"')) {
									try {
										cleanToken = JSON.parse(textContent);
									} catch (jsonError) {
										cleanToken = textContent.slice(1, -1);
									}
								} else if (textContent.includes('\\"') || textContent.includes('\\n')) {
									try {
										cleanToken = JSON.parse(`"${textContent}"`);
									} catch (jsonError) {
										cleanToken = textContent;
									}
								}

								if (cleanToken.includes('&lt;') || cleanToken.includes('&gt;') || cleanToken.includes('&amp;')) {
									cleanToken = he.decode(cleanToken);
								}

								newCleanTextInChunkForDisplay += cleanToken;
							} catch (e) {
								const textContent = line.substring(2);
								const cleanedContent = textContent.replace(/^["']|["']$/g, '');
								newCleanTextInChunkForDisplay += cleanedContent;
								console.warn('(Fallback) Error processing token for display:', line, e);
							}
						} else if (line.startsWith('e:') || line.startsWith('d:')) {
							try {
								const dataObj = JSON.parse(line.substring(2));
								if (dataObj.usage) processSpecialContent({ type: 'usage', value: dataObj.usage });
							} catch (e) { console.warn('Error parsing usage/data line:', e, "Line:", line); }
						}
					}

					if (newCleanTextInChunkForDisplay.length > 0) {
						accumulatedJsonLineBuffer += newCleanTextInChunkForDisplay;

						// Single unified parsing - no duplication
						const narrativeContent = await parseStreamContent(accumulatedJsonLineBuffer, false);

						setMessages(prev => {
							const updated = [...prev];
							if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
								updated[updated.length - 1].content = narrativeContent;
							} else {
								updated.push({ role: 'assistant', content: narrativeContent });
								console.log(`Added new assistant message with narrative content`);
							}
							return updated;
						});

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

								setMessages(prev => {
									const updated = [...prev];
									if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
										updated[updated.length - 1].content = `Error: ${errorMessage}`;
									}
									return updated;
								});

								return;
							}
						}
					}
				}
			}
		} catch (error) {
			console.error('Error processing SSE stream:', error);

			const errorMessage = error instanceof Error ? error.message : String(error);
			setOpenRouterError(errorMessage);

			if (accumulatedJsonLineBuffer.trim() === '') {
				setMessages(prev => {
					const updated = [...prev];
					if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
						updated[updated.length - 1].content = `Error: ${errorMessage}`;
					}
					return updated;
				});
			}

			await parseStreamContent(accumulatedJsonLineBuffer, true);
		} finally {
			console.log("Stream processing complete, setting final states");
			setStreamingComplete(true);
			setProcessingFiles(false);
			setIsApiRequestInProgress(false);
			setInput('');

			if (typeof window !== 'undefined') {
				const event = new CustomEvent('aiStreamingStateChange', {
					detail: { isStreaming: false, isProcessing: false }
				});
				window.dispatchEvent(event);
			}

			const currentStreamingContent = $workbench.get().streamingContent;
			if (currentStreamingContent && fileActionsCallbackRef.current) {
				console.log(`💾 [processSSEStream] Saving streamed content to workbench: ${currentStreamingContent.filePath} (${currentStreamingContent.content.length} chars)`);
				try {
					await fileActionsCallbackRef.current(currentStreamingContent.filePath, currentStreamingContent.content);
					console.log(`✅ [processSSEStream] Successfully saved streamed content for ${currentStreamingContent.filePath}`);
				} catch (error) {
					console.error(`❌ [processSSEStream] Failed to save streamed content for ${currentStreamingContent.filePath}:`, error);
				}
			}

			if (pendingActionsRef.current.files.length > 0 && fileActionsCallbackRef.current) {
				console.log(`💾 [processSSEStream] Processing ${pendingActionsRef.current.files.length} remaining pending file actions (WebContainer became available during streaming)`);
				const filesToProcess = [...pendingActionsRef.current.files];
				pendingActionsRef.current.files = [];

				for (const { path, content } of filesToProcess) {
					try {
						await fileActionsCallbackRef.current(path, content);
						console.log(`✅ [processSSEStream] Successfully processed remaining pending file action for ${path}`);
					} catch (error) {
						console.error(`❌ [processSSEStream] Failed to process remaining pending file action for ${path}:`, error);
					}
				}
			}

			clearStreamingContent();

			const finalCompletedFiles = fileExtractionStateRef.current.completedFiles;
			const finalCompletedCommands = fileExtractionStateRef.current.completedCommands;

			if (finalCompletedFiles.size > 0) {
				setCompletedFilesDisplay(prev => {
					const merged = new Set([...prev, ...finalCompletedFiles]);
					console.log(`[Finally] Final completed files:`, Array.from(finalCompletedFiles), `Merged total:`, merged.size);
					return merged;
				});
			}

			if (finalCompletedCommands.size > 0) {
				setCompletedCommandsDisplay(prev => {
					const merged = new Set([...prev, ...finalCompletedCommands]);
					console.log(`[Finally] Final completed commands:`, Array.from(finalCompletedCommands), `Merged total:`, merged.size);
					return merged;
				});
			}

			if (fileExtractionStateRef.current.completedFiles.size > 0 && setSelectedFileInEditor) {
				const firstFile = Array.from(fileExtractionStateRef.current.completedFiles)[0];
				setSelectedFileInEditor(firstFile);
				setWorkbenchView('Editor');
			}
			setActiveFile(null);
			setActiveCommand(null);

			fullAccumulatedStreamRef.current = '';
			fileExtractionStateRef.current = {
				accumulatedFileContent: '', completedFiles: new Set<string>(), lastScanLength: 0,
				insideAction: false, actionType: null, actionFilePath: null, currentActionStartIndex: -1,
				completedCommands: new Set<string>(),
			};
		}
	}, [parseStreamContent, processSpecialContent, setSelectedFileInEditor, setInput]);

	const commonSendMessageSetup = () => {
		setIsApiRequestInProgress(true);
		setOpenRouterError(null);
		partialResponseForDisplayRef.current = '';
		fullAccumulatedStreamRef.current = '';
		fileExtractionStateRef.current = {
			accumulatedFileContent: '', completedFiles: new Set<string>(), lastScanLength: 0,
			insideAction: false, actionType: null, actionFilePath: null, currentActionStartIndex: -1,
			completedCommands: new Set<string>(),
		};
		setStreamingData(null);
		setProcessingFiles(true);
		setStreamingComplete(false);
		setActiveFile(null);
		setCompletedFilesDisplay(new Set());
		setActiveCommand(null);
		setCompletedCommandsDisplay(new Set());

		clearStreamingContent();

		pendingActionsRef.current = {
			files: [],
			directories: [],
			commands: []
		};

		lastRequestIdRef.current = Date.now().toString() + Math.random().toString(36).slice(2, 9);

		if (typeof window !== 'undefined') {
			const event = new CustomEvent('aiStreamingStateChange', {
				detail: { isStreaming: true, isProcessing: true }
			});
			window.dispatchEvent(event);
		}
	};

	const sendMessageToAI = useCallback(async (newMessageContent: string, images?: UploadedImage[]) => {
		if (messages.length > 0 && lastProcessedMessageRef.current === newMessageContent.trim() && streamingComplete) {
			console.log("sendMessageToAI: Identical message already processed. To reprocess, modify the message slightly.");
			return false;
		}

		if (conversationId) {
			const cachedMessages = localStorage.getItem(`conversation_${conversationId}`);
			if (cachedMessages) {
				try {
					const parsedMessages = JSON.parse(cachedMessages);

					if (Array.isArray(parsedMessages) &&
						parsedMessages.some(m => m.role === 'user' && getTextContent(m.content) === newMessageContent.trim())) {

						const userMessageIndex = parsedMessages.findIndex(m =>
							m.role === 'user' && getTextContent(m.content) === newMessageContent.trim());

						if (userMessageIndex >= 0 && userMessageIndex < parsedMessages.length - 1 &&
							parsedMessages[userMessageIndex + 1].role === 'assistant') {
							setMessages(parsedMessages.slice(0, userMessageIndex + 2));
							return false;
						}
					}
				} catch (e) {
					console.warn("Error parsing cached messages:", e);
				}
			}
		}

		if (isApiRequestInProgress) {
			console.warn("sendMessageToAI: API request already in progress.");
			return false;
		}

		if (!newMessageContent.trim()) {
			console.warn("sendMessageToAI: Message empty");
			return false;
		}

		commonSendMessageSetup();

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

		setMessages(prev => {
			if (prev.length === 0) {
				console.log("No messages found, adding user message and assistant shell");
				return [newUserMessage, emptyAssistantMessage];
			}

			if (prev[prev.length - 1].role === 'user') {
				const lastUserContent = getTextContent(prev[prev.length - 1].content);
				const newUserContent = getTextContent(userMessageContent);

				if (lastUserContent === newUserContent) {
					console.log("Found duplicate user message, just adding assistant shell");
					return [...prev, emptyAssistantMessage];
				}
			}

			const updatedMessages = [...prev, newUserMessage, emptyAssistantMessage];
			return updatedMessages;
		});

		try {
			let currentWCFiles: Record<string, any> = {};
			const excludeDirs = ['/node_modules', '/.git', '/.next', '/dist', '/build', '/.cache', '/.vite', '/coverage'];

			if (messages.length === 0 && !webContainerInstance) {
				console.log("First message and no WebContainer, using minimal files context");
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
				if (webContainerInstance) {
					const readDirRecursive = async (path: string) => {
						try {
							if (excludeDirs.some(dir => path === dir || path.startsWith(dir + '/'))) return;
							const entries = await webContainerInstance.fs.readdir(path, { withFileTypes: true });
							for (const entry of entries) {
								const entryPath = `${path === '/' ? '' : path}/${entry.name}`;
								if (excludeDirs.some(dir => entryPath === dir || entryPath.startsWith(dir + '/'))) continue;
								if (entry.isFile()) {
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
				} else {
					try {
						const workbenchFiles = $workbench.get().files || {};

						if (Object.keys(workbenchFiles).length > 0) {
							console.log(`Using workbench files from store for context (${Object.keys(workbenchFiles).length} files)`);

							for (const [path, fileObj] of Object.entries(workbenchFiles)) {
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
							const windowWorkbenchStore = typeof window !== 'undefined' && window.$workbench
								? window.$workbench
								: null;

							if (windowWorkbenchStore) {
								const windowWorkbenchFiles = windowWorkbenchStore.get().files || {};

								if (Object.keys(windowWorkbenchFiles).length > 0) {
									console.log(`Using workbench files from window global for context (${Object.keys(windowWorkbenchFiles).length} files)`);

									for (const [path, fileObj] of Object.entries(windowWorkbenchFiles)) {
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

			const messagesForPayload = [...messages].filter(m => m.role !== 'assistant' || getTextContent(m.content).trim() !== '');
			if (!messagesForPayload.some(m => m.role === 'user' && getTextContent(m.content) === newMessageContent)) {
				messagesForPayload.push(newUserMessage);
			}

			const formattedMessages = messagesForPayload.map(m => ({ role: m.role, content: m.content }));
			const apiKeys = getAllApiKeysFromStorage(userId);

			const requestPayload = {
				messages: formattedMessages,
				files: currentWCFiles,
				promptId: 'default',
				contextOptimization: true,
				conversationId: conversationId,
				selectedModel: selectedModel,
				apiKeys: apiKeys
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
			setIsApiRequestInProgress(false);
			setStreamingComplete(true);
			setProcessingFiles(false);

			if (typeof window !== 'undefined') {
				const event = new CustomEvent('aiStreamingStateChange', {
					detail: { isStreaming: false, isProcessing: false }
				});
				window.dispatchEvent(event);
			}

			return false;
		}
	}, [
		messages, webContainerInstance, processSSEStream, isApiRequestInProgress, conversationId, streamingComplete, selectedModel
	]);

	const sendCurrentMessagesToLLM = useCallback(async () => {
		if (isApiRequestInProgress) { console.warn("sendCurrentMessagesToLLM: API request already in progress."); return false; }

		const messagesToUse = messages.length > 0 ? messages : (initialMessagesProp || []);

		if (messagesToUse.length === 0) { console.warn("sendCurrentMessagesToLLM: No messages available"); return false; }

		const formattedMessagesToUse = messagesToUse.length > 0 && messagesToUse[0].role
			? messagesToUse.map(m => ({ role: m.role, content: m.content }))
			: messagesToUse;

		if (formattedMessagesToUse[formattedMessagesToUse.length - 1].role !== 'user') {
			console.warn("sendCurrentMessagesToLLM: Last message not from user.");
			return false;
		}

		if (conversationId && formattedMessagesToUse.length >= 2) {
			const lastUserMessage = formattedMessagesToUse.filter(m => m.role === 'user').pop();
			const cachedMessages = localStorage.getItem(`conversation_${conversationId}`);

			if (cachedMessages) {
				try {
					const parsedMessages = JSON.parse(cachedMessages);
					if (Array.isArray(parsedMessages) &&
						lastUserMessage &&
						parsedMessages.some(m => m.role === 'user' && getTextContent(m.content) === getTextContent(lastUserMessage.content))) {

						return false;
					}
				} catch (e) {
					console.warn("Error parsing cached messages:", e);
				}
			}
		}

		if (conversationId && formattedMessagesToUse.length > 0) {
			try {
				localStorage.setItem(`conversation_${conversationId}`, JSON.stringify(formattedMessagesToUse));
			} catch (e) {
				console.warn("Error saving conversation to localStorage:", e);
			}
		}

		if (messages.length === 0 && formattedMessagesToUse.length > 0) {
			console.log("Updating messages state from initialMessagesProp before API call");
			setMessages(formattedMessagesToUse);
		}

		commonSendMessageSetup();
		const currentRequestId = lastRequestIdRef.current;

		const lastUserMessage = formattedMessagesToUse[formattedMessagesToUse.length - 1];

		if (lastProcessedMessageRef.current === getTextContent(lastUserMessage.content).trim() && streamingComplete) {
			console.log("sendCurrentMessagesToLLM: Identical message already processed");
			setIsApiRequestInProgress(false);
			return false;
		}

		setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

		try {
			let currentWCFiles: Record<string, any> = {};
			const excludeDirs = ['/node_modules', '/.git', '/.next', '/dist', '/build', '/.cache', '/.vite', '/coverage'];

			if (formattedMessagesToUse.length === 1 && !webContainerInstance) {
				console.log("First message and no WebContainer, using minimal files context");
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
				if (webContainerInstance) {
					const readDirRecursive = async (path: string) => {
						try {
							if (excludeDirs.some(dir => path === dir || path.startsWith(dir + '/'))) return;
							const entries = await webContainerInstance.fs.readdir(path, { withFileTypes: true });
							for (const entry of entries) {
								const entryPath = `${path === '/' ? '' : path}/${entry.name}`;
								if (excludeDirs.some(dir => entryPath === dir || entryPath.startsWith(dir + '/'))) continue;
								if (entry.isFile()) {
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
				} else {
					try {
						const workbenchFiles = $workbench.get().files || {};

						if (Object.keys(workbenchFiles).length > 0) {
							console.log(`Using workbench files from store for context (${Object.keys(workbenchFiles).length} files)`);

							for (const [path, fileObj] of Object.entries(workbenchFiles)) {
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
							console.log('No files in store, trying window.$workbench');
							const windowWorkbenchStore = typeof window !== 'undefined' && window.$workbench
								? window.$workbench
								: null;

							if (windowWorkbenchStore) {
								const windowWorkbenchFiles = windowWorkbenchStore.get().files || {};

								if (Object.keys(windowWorkbenchFiles).length > 0) {
									console.log(`Using workbench files from window global for context (${Object.keys(windowWorkbenchFiles).length} files)`);

									for (const [path, fileObj] of Object.entries(windowWorkbenchFiles)) {
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

			if (currentRequestId !== lastRequestIdRef.current) {
				console.warn("Request superseded while collecting files. Aborting.");
				setIsApiRequestInProgress(false);
				return false;
			}

			const messagesForPayload = formattedMessagesToUse.filter(m => m.role !== 'assistant' || getTextContent(m.content).trim() !== '');

			const formattedMessages = messagesForPayload.map(m => ({ role: m.role, content: m.content }));

			const apiKeys = getAllApiKeysFromStorage(userId);

			const requestPayload = {
				messages: formattedMessages,
				files: currentWCFiles,
				promptId: 'default',
				contextOptimization: true,
				conversationId: conversationId,
				selectedModel: selectedModel,
				apiKeys: apiKeys
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
			setIsApiRequestInProgress(false);
			setStreamingComplete(true);
			setProcessingFiles(false);

			if (typeof window !== 'undefined') {
				const event = new CustomEvent('aiStreamingStateChange', {
					detail: { isStreaming: false, isProcessing: false }
				});
				window.dispatchEvent(event);
			}

			return false;
		}
	}, [
		messages, initialMessagesProp, webContainerInstance, processSSEStream, isApiRequestInProgress, conversationId, streamingComplete, selectedModel
	]);

	const stopStreaming = useCallback(() => {
		console.log("Attempting to stop streaming (client-side state update)...");
		setStreamingComplete(true);
		setProcessingFiles(false);
		setIsApiRequestInProgress(false);
		setActiveFile(null);
		setActiveCommand(null);
	}, []);

	const pendingActionsRef = useRef<{
		files: Array<{ path: string, content: string }>;
		directories: Array<string>;
		commands: Array<string>;
	}>({
		files: [],
		directories: [],
		commands: []
	});

	useEffect(() => {
		console.log(`🔍 [useAIChat] Checking pending actions: WebContainer=${!!webContainerInstance}, files=${pendingActionsRef.current.files.length}, dirs=${pendingActionsRef.current.directories.length}, commands=${pendingActionsRef.current.commands.length}`);

		if (!webContainerInstance ||
			(!pendingActionsRef.current.files.length &&
				!pendingActionsRef.current.directories.length &&
				!pendingActionsRef.current.commands.length)) {
			return;
		}

		const executePendingActions = async () => {
			console.log(`🎯 [useAIChat] WebContainer is now available! Executing ${pendingActionsRef.current.files.length} pending file actions, ${pendingActionsRef.current.directories.length} directory actions, and ${pendingActionsRef.current.commands.length} commands.`);

			if (pendingActionsRef.current.directories.length > 0 && directoryActionsCallbackRef.current) {
				for (const dirPath of pendingActionsRef.current.directories) {
					try {
						await directoryActionsCallbackRef.current(dirPath);
						console.log(`✅ Executed pending directory action: ${dirPath}`);
					} catch (e) {
						console.error(`❌ Error executing pending directory action for ${dirPath}:`, e);
					}
				}
				pendingActionsRef.current.directories = [];
			}

			if (pendingActionsRef.current.files.length > 0 && fileActionsCallbackRef.current) {
				const filesToCreate = [...pendingActionsRef.current.files];
				pendingActionsRef.current.files = [];

				let selectedFileToOpen: string | null = null;

				for (const { path, content } of filesToCreate) {
					try {
						await fileActionsCallbackRef.current(path, content);
						setCompletedFilesDisplay(prev => new Set([...prev, path]));

						if (!selectedFileToOpen) {
							selectedFileToOpen = path;
						}
					} catch (e) {
						console.error(`❌ Error executing pending file action for ${path}:`, e);
					}
				}

				if (selectedFileToOpen && setSelectedFileInEditor) {
					console.log(`📁 Selecting file in editor after all files created: ${selectedFileToOpen}`);
					setTimeout(() => {
						setSelectedFileInEditor(selectedFileToOpen);
						setWorkbenchView('Editor');
					}, 50);
				}

				if (projectId && userId) {
					console.log('Pending file actions executed, triggering auto-sync');
					setTimeout(() => syncFilesToProject(), 1000);
				}
			}

			if (pendingActionsRef.current.commands.length > 0 && terminalActionsCallbackRef.current) {
				const commandsToRun = [...pendingActionsRef.current.commands];
				pendingActionsRef.current.commands = [];

				for (const command of commandsToRun) {
					try {
						await terminalActionsCallbackRef.current(command);
						console.log(`✅ Executed pending command: ${command}`);
					} catch (e) {
						console.error(`❌ Error executing pending command: ${command}`, e);
					}
				}
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
