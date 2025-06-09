'use client';

import Editor, { OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { useEffect, useRef, useState } from 'react';

interface CodeEditorProps {
    value: string;
    onChange: (value: string) => void;
    language: string;
    readOnly?: boolean;
}

export default function CodeEditor2({ value, onChange, language, readOnly = false, }: CodeEditorProps) {
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<typeof monaco | null>(null);
    const [isEditorMounted, setIsEditorMounted] = useState(false);

    const handleEditorDidMount: OnMount = (editorInstance, monacoInstance) => {
        editorRef.current = editorInstance;
        monacoRef.current = monacoInstance;
        setIsEditorMounted(true);

        // Configure TypeScript compiler options
        monacoInstance.languages.typescript.typescriptDefaults.setCompilerOptions({
            jsx: monacoInstance.languages.typescript.JsxEmit.ReactJSX,
            jsxImportSource: 'react',
            esModuleInterop: true,
            allowNonTsExtensions: true,
            allowSyntheticDefaultImports: true,
            moduleResolution: monacoInstance.languages.typescript.ModuleResolutionKind.NodeJs,
            module: monacoInstance.languages.typescript.ModuleKind.ESNext,
            target: monacoInstance.languages.typescript.ScriptTarget.ES2020,
            lib: ['ES2020', 'DOM', 'DOM.Iterable'],
            resolveJsonModule: true,
            noEmit: true,
            allowJs: true,
            skipLibCheck: true,
        });

        // Configure JavaScript compiler options
        monacoInstance.languages.typescript.javascriptDefaults.setCompilerOptions({
            jsx: monacoInstance.languages.typescript.JsxEmit.ReactJSX,
            jsxImportSource: 'react',
            esModuleInterop: true,
            allowNonTsExtensions: true,
            allowSyntheticDefaultImports: true,
            moduleResolution: monacoInstance.languages.typescript.ModuleResolutionKind.NodeJs,
            module: monacoInstance.languages.typescript.ModuleKind.ESNext,
            target: monacoInstance.languages.typescript.ScriptTarget.ES2020,
            lib: ['ES2020', 'DOM', 'DOM.Iterable'],
            resolveJsonModule: true,
            noEmit: true,
            allowJs: true,
            skipLibCheck: true,
        });

        // Reduce TypeScript diagnostics for better performance
        const diagnosticCodesToIgnore = [
            1109, 1108, 1005, 1002, 1003, 1009, 2792, 2304, 2307, 2339, 2365, 2635,
            7016, 7027, 7053, 2571, 2322, 2345, 2531, 2532, 18048, 8013, 2488, 2584, 5097, 8010, 8006
        ];

        monacoInstance.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
            noSemanticValidation: false,
            noSyntaxValidation: false,
            noSuggestionDiagnostics: true,
            diagnosticCodesToIgnore: diagnosticCodesToIgnore
        });

        monacoInstance.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
            noSemanticValidation: false,
            noSyntaxValidation: false,
            noSuggestionDiagnostics: true,
            diagnosticCodesToIgnore: diagnosticCodesToIgnore
        });

        // Minimal React type definitions
        const minimalReactDTS = `
declare module 'react' {
    type ReactNode = ReactElement | string | number | boolean | null | undefined;
    interface ReactElement<P = any> {
        type: any;
        props: P;
        key: string | number | null;
    }

    export function useState<S>(initialState: S | (() => S)): [S, (newState: S | ((prevState: S) => S)) => void];
    export function useEffect(effect: () => void | (() => void), deps?: ReadonlyArray<any>): void;
    export function useCallback<T extends (...args: any[]) => any>(callback: T, deps: ReadonlyArray<any>): T;
    export function useMemo<T>(factory: () => T, deps: ReadonlyArray<any> | undefined): T;
    export function useRef<T>(initialValue: T): { current: T };

    export function createElement<P extends {}>(type: any, props?: P | null, ...children: ReactNode[]): ReactElement<P>;

    interface HTMLAttributes<T> {
        className?: string;
        style?: any;
        children?: ReactNode;
        [key: string]: any;
    }

    const React: {
        useState: typeof useState;
        useEffect: typeof useEffect;
        useCallback: typeof useCallback;
        useMemo: typeof useMemo;
        useRef: typeof useRef;
        createElement: typeof createElement;
    };
    export default React;
}

declare module 'react-dom/client' {
    import { ReactNode } from 'react';
    export interface Root {
        render(children: ReactNode): void;
        unmount(): void;
    }
    export function createRoot(container: Element | DocumentFragment | null): Root;
}

declare global {
    namespace JSX {
        interface Element extends React.ReactElement<any, any> { }
        interface IntrinsicElements {
            [elemName: string]: any;
        }
    }
}
`;
        monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(minimalReactDTS, 'file:///node_modules/@types/react/index.d.ts');
        monacoInstance.languages.typescript.javascriptDefaults.addExtraLib(minimalReactDTS, 'file:///node_modules/@types/react/index.d.ts');

        // Configure editor theme
        monacoInstance.editor.defineTheme('darkerTheme', {
            base: 'vs-dark',
            inherit: true,
            rules: [],
            colors: {
                'editor.background': '#161618',
                'editor.foreground': '#f3f6f6',
                'editorLineNumber.foreground': '#969798',
                'editorLineNumber.activeForeground': '#f3f6f6',
                'editorIndentGuide.background': '#2a2a2c',
                'editor.selectionBackground': '#2a2a2c',
                'editor.inactiveSelectionBackground': '#212122',
                'editor.lineHighlightBackground': '#1c1c1e',
                'editorWidget.background': '#161618',
                'editorWidget.border': '#313133',
                'input.background': '#161618',
                'input.border': '#313133',
                'inputOption.activeBorder': '#007acc',
                'focusBorder': '#007acc',
            }
        });

        monacoInstance.editor.setTheme('darkerTheme');

        // Configure editor options
        editorInstance.updateOptions({
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 14,
            readOnly: readOnly,
            find: {
                addExtraSpaceOnTop: false,
                autoFindInSelection: 'never',
                seedSearchStringFromSelection: 'always',
            },
        });

        // Add keyboard shortcuts
        editorInstance.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyF, () => {
            editorInstance.getAction('actions.find')?.run();
        });

        editorInstance.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyH, () => {
            editorInstance.getAction('editor.action.startFindReplaceAction')?.run();
        });

        editorInstance.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyG, () => {
            editorInstance.getAction('editor.action.goToLine')?.run();
        });
    };

    useEffect(() => {
        if (editorRef.current && isEditorMounted && value !== undefined) {
            const currentValue = editorRef.current.getValue();
            if (currentValue !== value) {
                try {
                    if (readOnly && value.length > currentValue.length) {
                        // For streaming content, append new content
                        const newContent = value.slice(currentValue.length);
                        if (newContent) {
                            const position = editorRef.current.getModel()?.getPositionAt(currentValue.length);
                            if (position) {
                                editorRef.current.getModel()?.pushEditOperations([], [{
                                    range: new monacoRef.current!.Range(position.lineNumber, position.column, position.lineNumber, position.column),
                                    text: newContent
                                }], () => null);
                            } else {
                                editorRef.current.setValue(value);
                            }
                        }
                    } else {
                        editorRef.current.setValue(value);
                    }
                } catch (error) {
                    if (error instanceof Error && error.message.includes('Canceled')) {
                        // Suppress cancellation errors during rapid updates
                    } else {
                        console.warn('Monaco editor update error:', error);
                    }
                }
            }
        }
    }, [value, isEditorMounted, readOnly]);

    // Handle readOnly changes
    useEffect(() => {
        if (editorRef.current && isEditorMounted) {
            editorRef.current.updateOptions({ readOnly: readOnly });
        }
    }, [readOnly, isEditorMounted]);

    return (
        <Editor
            height="100%"
            language={language}
            value={value}
            theme="vs-dark"
            onChange={(val) => onChange(val || '')}
            onMount={handleEditorDidMount}
            options={{
                automaticLayout: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 13,
                lineNumbersMinChars: 3,
                readOnly: readOnly,
            }}
        />
    );
}
