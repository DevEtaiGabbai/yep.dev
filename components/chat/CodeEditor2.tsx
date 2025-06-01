'use client';

import Editor, { OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { useEffect, useRef, useState } from 'react';

interface CodeEditorProps {
    value: string;
    onChange: (value: string) => void;
    language: string;
}


export default function CodeEditor2({ value, onChange, language }: CodeEditorProps) {
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<typeof monaco | null>(null);
    const [isEditorMounted, setIsEditorMounted] = useState(false);
    const handleEditorDidMount: OnMount = (editorInstance, monacoInstance) => {
        editorRef.current = editorInstance;
        monacoRef.current = monacoInstance;
        setIsEditorMounted(true);

        // Configure TypeScript compiler options to resolve React type errors
        monacoInstance.languages.typescript.typescriptDefaults.setCompilerOptions({
            jsx: monacoInstance.languages.typescript.JsxEmit.ReactJSX,
            jsxImportSource: 'react',
            esModuleInterop: true,
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

        // Configure JavaScript compiler options as well
        monacoInstance.languages.typescript.javascriptDefaults.setCompilerOptions({
            jsx: monacoInstance.languages.typescript.JsxEmit.ReactJSX,
            jsxImportSource: 'react',
            esModuleInterop: true,
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

        // Minimal list of diagnostic codes to ignore - aim for zero if possible.
        const diagnosticCodesToIgnore = [
            // 7016, // Could not find declaration file for module 'X'. (If stubs are not perfect)
            // 2339, // Property 'X' does not exist on type '{}'. (Often for 'any' types)
        ];

        monacoInstance.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
            noSemanticValidation: false,
            noSyntaxValidation: false,
            diagnosticCodesToIgnore: diagnosticCodesToIgnore
        });

        monacoInstance.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
            noSemanticValidation: false,
            noSyntaxValidation: false,
            diagnosticCodesToIgnore: diagnosticCodesToIgnore
        });

        // --- Minimal React type definitions ---
        const minimalReactDTS = `
declare module 'react' {
    type Key = string | number;
    type Ref<T> = string | { current: T | null } | ((instance: T | null) => void);
    type ReactNode = ReactElement | string | number | ReactFragment | ReactPortal | boolean | null | undefined;
    interface Attributes { key?: Key; }
    interface ClassAttributes<T> extends Attributes { ref?: Ref<T>; }
    interface ReactElement<P = any, T extends string | JSXElementConstructor<any> = string | JSXElementConstructor<any>> {
        type: T;
        props: P;
        key: Key | null;
    }
    type ReactFragment = Iterable<ReactNode>;
    type ReactPortal = ReactElement & { children: ReactNode };
    type JSXElementConstructor<P> = ((props: P) => ReactElement<any, any> | null) | (new (props: P) => Component<P, any>);

    export function useState<S>(initialState: S | (() => S)): [S, (newState: S | ((prevState: S) => S)) => void];
    export function useEffect(effect: () => void | (() => void), deps?: ReadonlyArray<any>): void;
    export function useContext<T>(context: Context<T>): T;
    export function useReducer<R extends Reducer<any, any>, I>(reducer: R, initializerArg: I, initializer?: (arg: I) => ReducerState<R>): [ReducerState<R>, Dispatch<ReducerAction<R>>];
    export function useCallback<T extends (...args: any[]) => any>(callback: T, deps: ReadonlyArray<any>): T;
    export function useMemo<T>(factory: () => T, deps: ReadonlyArray<any> | undefined): T;
    export function useRef<T>(initialValue: T): { current: T };

    export const StrictMode: ({ children?: ReactNode }) => ReactElement;
    export const Fragment: ({ children?: ReactNode }) => ReactElement;

    interface Context<T> { Provider: Provider<T>; Consumer: Consumer<T>; displayName?: string; }
    interface Provider<T> { ({ value, children }: { value: T; children?: ReactNode; }): ReactElement; }
    interface Consumer<T> { ({ children }: { children: (value: T) => ReactNode; }): ReactElement; }
    export function createContext<T>(defaultValue: T): Context<T>;

    class Component<P = {}, S = {}> { constructor(props: Readonly<P>); setState<K extends keyof S>(state: ((prevState: Readonly<S>, props: Readonly<P>) => (Pick<S, K> | S | null)) | (Pick<S, K> | S | null), callback?: () => void): void; forceUpdate(callback?: () => void): void; render(): ReactNode; readonly props: Readonly<P>; state: Readonly<S>; }
    type Reducer<S, A> = (prevState: S, action: A) => S;
    type ReducerState<R extends Reducer<any, any>> = R extends Reducer<infer S, any> ? S : never;
    type ReducerAction<R extends Reducer<any, any>> = R extends Reducer<any, infer A> ? A : never;
    type Dispatch<A> = (value: A) => void;

    export function createElement<P extends {}>(type: string | JSXElementConstructor<P>, props?: Attributes & P | null, ...children: ReactNode[]): ReactElement<P>;

    const React: {
        useState: typeof useState;
        useEffect: typeof useEffect;
        useContext: typeof useContext;
        useReducer: typeof useReducer;
        useCallback: typeof useCallback;
        useMemo: typeof useMemo;
        useRef: typeof useRef;
        StrictMode: typeof StrictMode;
        Fragment: typeof Fragment;
        createContext: typeof createContext;
        createElement: typeof createElement;
    };
    export default React;

    // React specific HTML attributes
    interface HTMLAttributes<T> extends AriaAttributes, DOMAttributes<T> {
        defaultChecked?: boolean;
        defaultValue?: string | ReadonlyArray<string> | number;
        suppressContentEditableWarning?: boolean;
        suppressHydrationWarning?: boolean;
        accessKey?: string;
        className?: string;
        contentEditable?: "inherit" | (boolean | "true" | "false");
        style?: CSSProperties;
        children?: ReactNode;
        [key: string]: any;
    }
    type DetailedHTMLProps<E extends HTMLAttributes<T>, T> = ClassAttributes<T> & E;
    interface CSSProperties { [key: string]: string | number | undefined; }
    interface DOMAttributes<T> { children?: ReactNode; dangerouslySetInnerHTML?: { __html: string; }; /* Add other event handlers if needed */ }
    interface AriaAttributes { /* Basic Aria attributes */ role?: string; 'aria-label'?: string; [key: \`aria-\${string}\`]: string | boolean | number | undefined; }
    interface AnchorHTMLAttributes<T> extends HTMLAttributes<T> { href?: string; target?: string; download?: any; rel?: string; }
    interface ImgHTMLAttributes<T> extends HTMLAttributes<T> { src?: string; alt?: string; }
    interface ButtonHTMLAttributes<T> extends HTMLAttributes<T> { type?: 'submit' | 'reset' | 'button'; }
    // Add more specific element attributes if needed
}

// Augment JSX namespace globally
declare global {
    namespace JSX {
        interface Element extends React.ReactElement<any, any> { }
        interface ElementClass extends React.Component<any> { render(): React.ReactNode; }
        interface ElementAttributesProperty { props: {}; }
        interface ElementChildrenAttribute { children: React.ReactNode | React.ReactNode[]; }
        interface IntrinsicAttributes extends React.Attributes {}
        interface IntrinsicClassAttributes<T> extends React.ClassAttributes<T> {}
        interface IntrinsicElements {
            a: React.DetailedHTMLProps<React.AnchorHTMLAttributes<HTMLAnchorElement>, HTMLAnchorElement>;
            img: React.DetailedHTMLProps<React.ImgHTMLAttributes<HTMLImageElement>, HTMLImageElement>;
            div: React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>;
            span: React.DetailedHTMLProps<React.HTMLAttributes<HTMLSpanElement>, HTMLSpanElement>;
            p: React.DetailedHTMLProps<React.HTMLAttributes<HTMLParagraphElement>, HTMLParagraphElement>;
            button: React.DetailedHTMLProps<React.ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement>;
            // Add more common HTML elements here as needed
            [elemName: string]: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>; // Fallback
        }
    }
}
`;
        monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(minimalReactDTS, 'file:///node_modules/@types/react/index.d.ts');
        monacoInstance.languages.typescript.javascriptDefaults.addExtraLib(minimalReactDTS, 'file:///node_modules/@types/react/index.d.ts');

        // --- Stub for react-dom/client ---
        const reactDomClientDTS = `
declare module 'react-dom/client' {
    import { ReactNode } from 'react';
    export interface Root {
        render(children: ReactNode): void;
        unmount(): void;
    }
    export function createRoot(container: Element | DocumentFragment | null, options?: { hydrate?: boolean }): Root;
}
`;
        monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(reactDomClientDTS, 'file:///node_modules/@types/react-dom/client/index.d.ts');
        monacoInstance.languages.typescript.javascriptDefaults.addExtraLib(reactDomClientDTS, 'file:///node_modules/@types/react-dom/client/index.d.ts');

        // --- Stubs for local modules (example) ---
        const appStubDTS = `
declare module './App.tsx' { // Path should match import in user's code
    import { ReactElement } from 'react';
    const App: () => ReactElement;
    export default App;
}
`;
        // Using a generic path for the stub might be necessary if Monaco doesn't resolve relative paths well for addExtraLib
        monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(appStubDTS, 'file:///App.tsx.d.ts'); // Or try 'file:///./App.tsx'
        monacoInstance.languages.typescript.javascriptDefaults.addExtraLib(appStubDTS, 'file:///App.tsx.d.ts');

        const cssStubDTS = `
declare module './index.css' { // Path should match import
    const styles: { [className: string]: string };
    export default styles;
}
`;
        monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(cssStubDTS, 'file:///index.css.d.ts'); // Or try 'file:///./index.css'
        monacoInstance.languages.typescript.javascriptDefaults.addExtraLib(cssStubDTS, 'file:///index.css.d.ts');

        // Add more stubs as needed for other direct imports in user's entry files

        // Configure editor options
        editorInstance.updateOptions({
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 14,
            find: {
                addExtraSpaceOnTop: false,
                autoFindInSelection: 'never',
                seedSearchStringFromSelection: 'always',
            },
        });

        // Set up custom theme
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
                console.log('Updating editor value from props', {
                    currentLength: currentValue.length,
                    newLength: value.length
                });
                editorRef.current.setValue(value);
            }
        }
    }, [value, isEditorMounted]);

    // Handle language changes
    useEffect(() => {
        if (editorRef.current && monacoRef.current && isEditorMounted) {
            const model = editorRef.current.getModel();
            if (model) {
                console.log('Setting editor language to:', language);
                monacoRef.current.editor.setModelLanguage(model, language);
            }
        }
    }, [language, isEditorMounted]);


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
            }}
        />
    );
}
