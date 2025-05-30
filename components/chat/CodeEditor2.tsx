// app/components/chat/CodeEditor2.tsx
'use client';

import Editor, { OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor'; // Keep this for types
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
            jsx: monacoInstance.languages.typescript.JsxEmit.React,
            jsxImportSource: 'react',
            allowNonTsExtensions: true,
            esModuleInterop: true,
            allowSyntheticDefaultImports: true,
            moduleResolution: monacoInstance.languages.typescript.ModuleResolutionKind.NodeJs,
            target: monacoInstance.languages.typescript.ScriptTarget.ES2020,
            lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        });

        // Configure JavaScript compiler options as well
        monacoInstance.languages.typescript.javascriptDefaults.setCompilerOptions({
            jsx: monacoInstance.languages.typescript.JsxEmit.React,
            jsxImportSource: 'react',
            allowNonTsExtensions: true,
            esModuleInterop: true,
            allowSyntheticDefaultImports: true,
            moduleResolution: monacoInstance.languages.typescript.ModuleResolutionKind.NodeJs,
            target: monacoInstance.languages.typescript.ScriptTarget.ES2020,
            lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        });

        // Disable strict type checking to reduce noise
        monacoInstance.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
            noSemanticValidation: false, // Enable semantic validation but configure it
            noSyntaxValidation: false,   // Enable syntax validation
            diagnosticCodesToIgnore: [
                1108, // Return statement in function
                1005, // Expected token
                1002, // Unterminated string literal
                1003, // Identifier expected
                1009, // Trailing comma
                2792, // Cannot find module (this is the main error you're seeing)
                2304, // Cannot find name
                2307, // Cannot find module
                2339, // Property 'map' does not exist on type '{}'
                2365, // Operator '>' cannot be applied to types
                2635, // Type '{}' has no signatures for which the type argument list is applicable
                7016, // Could not find declaration file
                7027, // Unreachable code detected
                7053, // Element implicitly has an 'any' type
                2571, // Object is of type 'unknown'
                2322, // Type is not assignable to type
                2345, // Argument of type is not assignable to parameter of type
                2531, // Object is possibly 'null'
                2532, // Object is possibly 'undefined'
                18048, // Element implicitly has an 'any' type because expression of type can't be used to index type
            ]
        });

        // Also configure JavaScript diagnostics
        monacoInstance.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
            noSemanticValidation: false,
            noSyntaxValidation: false,
            diagnosticCodesToIgnore: [
                1108, 1005, 1002, 1003, 1009, 2792, 2304, 2307, 2339, 2365, 2635, 7016, 7027, 7053, 2571, 2322, 2345, 2531, 2532, 18048
            ]
        });

        // Add comprehensive type definitions
        const comprehensiveTypes = `
declare module 'react' {
    export interface HTMLAttributes<T> {
        className?: string;
        style?: React.CSSProperties;
        onClick?: (event: React.MouseEvent<T>) => void;
        onChange?: (event: React.ChangeEvent<T>) => void;
        onSubmit?: (event: React.FormEvent<T>) => void;
        children?: React.ReactNode;
        [key: string]: any;
    }
    
    export interface CSSProperties {
        [key: string]: string | number | undefined;
    }
    
    export type ReactNode = string | number | boolean | React.ReactElement | React.ReactFragment | React.ReactPortal | null | undefined;
    export type ReactElement = any;
    export type ReactFragment = any;
    export type ReactPortal = any;
    export type MouseEvent<T = Element> = any;
    export type ChangeEvent<T = Element> = any;
    export type FormEvent<T = Element> = any;
    
    export function createElement(type: any, props?: any, ...children: any[]): ReactElement;
    export function useState<T>(initialState: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void];
    export function useEffect(effect: () => void | (() => void), deps?: any[]): void;
    export function useCallback<T extends (...args: any[]) => any>(callback: T, deps: any[]): T;
    export function useMemo<T>(factory: () => T, deps: any[]): T;
    export function useRef<T>(initialValue: T): { current: T };
    export function useContext<T>(context: any): T;
    
    export const Fragment: any;
    export default React;
}

// Add comprehensive built-in types
declare global {
    interface Array<T> {
        map<U>(callbackfn: (value: T, index: number, array: T[]) => U, thisArg?: any): U[];
        filter(predicate: (value: T, index: number, array: T[]) => any, thisArg?: any): T[];
        forEach(callbackfn: (value: T, index: number, array: T[]) => void, thisArg?: any): void;
        find(predicate: (value: T, index: number, obj: T[]) => any, thisArg?: any): T | undefined;
        findIndex(predicate: (value: T, index: number, obj: T[]) => any, thisArg?: any): number;
        reduce<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U;
        some(predicate: (value: T, index: number, array: T[]) => any, thisArg?: any): boolean;
        every(predicate: (value: T, index: number, array: T[]) => any, thisArg?: any): boolean;
        includes(searchElement: T, fromIndex?: number): boolean;
        indexOf(searchElement: T, fromIndex?: number): number;
        join(separator?: string): string;
        slice(start?: number, end?: number): T[];
        splice(start: number, deleteCount?: number, ...items: T[]): T[];
        push(...items: T[]): number;
        pop(): T | undefined;
        shift(): T | undefined;
        unshift(...items: T[]): number;
        reverse(): T[];
        sort(compareFn?: (a: T, b: T) => number): T[];
        length: number;
        [n: number]: T;
    }

    interface Object {
        [key: string]: any;
    }

    interface String {
        length: number;
        charAt(pos: number): string;
        charCodeAt(index: number): number;
        concat(...strings: string[]): string;
        indexOf(searchString: string, position?: number): number;
        lastIndexOf(searchString: string, position?: number): number;
        localeCompare(that: string): number;
        match(regexp: string | RegExp): RegExpMatchArray | null;
        replace(searchValue: string | RegExp, replaceValue: string): string;
        search(regexp: string | RegExp): number;
        slice(start?: number, end?: number): string;
        split(separator?: string | RegExp, limit?: number): string[];
        substring(start: number, end?: number): string;
        toLowerCase(): string;
        toLocaleLowerCase(): string;
        toUpperCase(): string;
        toLocaleUpperCase(): string;
        trim(): string;
        substr(from: number, length?: number): string;
        valueOf(): string;
        [index: number]: string;
    }

    interface Number {
        toString(radix?: number): string;
        toFixed(fractionDigits?: number): string;
        toExponential(fractionDigits?: number): string;
        toPrecision(precision?: number): string;
        valueOf(): number;
    }

    interface Boolean {
        valueOf(): boolean;
    }

    interface RegExp {
        exec(string: string): RegExpExecArray | null;
        test(string: string): boolean;
        source: string;
        global: boolean;
        ignoreCase: boolean;
        multiline: boolean;
        lastIndex: number;
        compile(): RegExp;
    }

    interface Date {
        toString(): string;
        toDateString(): string;
        toTimeString(): string;
        toLocaleString(): string;
        toLocaleDateString(): string;
        toLocaleTimeString(): string;
        valueOf(): number;
        getTime(): number;
        getFullYear(): number;
        getUTCFullYear(): number;
        getMonth(): number;
        getUTCMonth(): number;
        getDate(): number;
        getUTCDate(): number;
        getDay(): number;
        getUTCDay(): number;
        getHours(): number;
        getUTCHours(): number;
        getMinutes(): number;
        getUTCMinutes(): number;
        getSeconds(): number;
        getUTCSeconds(): number;
        getMilliseconds(): number;
        getUTCMilliseconds(): number;
        getTimezoneOffset(): number;
        setTime(time: number): number;
        setMilliseconds(ms: number): number;
        setUTCMilliseconds(ms: number): number;
        setSeconds(sec: number, ms?: number): number;
        setUTCSeconds(sec: number, ms?: number): number;
        setMinutes(min: number, sec?: number, ms?: number): number;
        setUTCMinutes(min: number, sec?: number, ms?: number): number;
        setHours(hours: number, min?: number, sec?: number, ms?: number): number;
        setUTCHours(hours: number, min?: number, sec?: number, ms?: number): number;
        setDate(date: number): number;
        setUTCDate(date: number): number;
        setMonth(month: number, date?: number): number;
        setUTCMonth(month: number, date?: number): number;
        setFullYear(year: number, month?: number, date?: number): number;
        setUTCFullYear(year: number, month?: number, date?: number): number;
        toUTCString(): string;
        toISOString(): string;
        toJSON(key?: any): string;
    }

    namespace JSX {
        interface IntrinsicElements {
            div: React.HTMLAttributes<HTMLDivElement>;
            span: React.HTMLAttributes<HTMLSpanElement>;
            p: React.HTMLAttributes<HTMLParagraphElement>;
            h1: React.HTMLAttributes<HTMLHeadingElement>;
            h2: React.HTMLAttributes<HTMLHeadingElement>;
            h3: React.HTMLAttributes<HTMLHeadingElement>;
            h4: React.HTMLAttributes<HTMLHeadingElement>;
            h5: React.HTMLAttributes<HTMLHeadingElement>;
            h6: React.HTMLAttributes<HTMLHeadingElement>;
            button: React.HTMLAttributes<HTMLButtonElement>;
            input: React.HTMLAttributes<HTMLInputElement>;
            form: React.HTMLAttributes<HTMLFormElement>;
            img: React.HTMLAttributes<HTMLImageElement>;
            a: React.HTMLAttributes<HTMLAnchorElement>;
            ul: React.HTMLAttributes<HTMLUListElement>;
            ol: React.HTMLAttributes<HTMLOListElement>;
            li: React.HTMLAttributes<HTMLLIElement>;
            nav: React.HTMLAttributes<HTMLElement>;
            header: React.HTMLAttributes<HTMLElement>;
            footer: React.HTMLAttributes<HTMLElement>;
            main: React.HTMLAttributes<HTMLElement>;
            section: React.HTMLAttributes<HTMLElement>;
            article: React.HTMLAttributes<HTMLElement>;
            aside: React.HTMLAttributes<HTMLElement>;
            table: React.HTMLAttributes<HTMLTableElement>;
            thead: React.HTMLAttributes<HTMLTableSectionElement>;
            tbody: React.HTMLAttributes<HTMLTableSectionElement>;
            tr: React.HTMLAttributes<HTMLTableRowElement>;
            td: React.HTMLAttributes<HTMLTableDataCellElement>;
            th: React.HTMLAttributes<HTMLTableHeaderCellElement>;
            [elemName: string]: any;
        }
    }

    // Add console for debugging
    declare var console: {
        log(...args: any[]): void;
        error(...args: any[]): void;
        warn(...args: any[]): void;
        info(...args: any[]): void;
        debug(...args: any[]): void;
        trace(...args: any[]): void;
        assert(condition?: boolean, ...data: any[]): void;
        clear(): void;
        count(label?: string): void;
        countReset(label?: string): void;
        dir(item?: any, options?: any): void;
        dirxml(...data: any[]): void;
        group(...data: any[]): void;
        groupCollapsed(...data: any[]): void;
        groupEnd(): void;
        table(tabularData?: any, properties?: string[]): void;
        time(label?: string): void;
        timeEnd(label?: string): void;
        timeLog(label?: string, ...data: any[]): void;
        timeStamp(label?: string): void;
    };

    // Add JSON
    declare var JSON: {
        parse(text: string, reviver?: (this: any, key: string, value: any) => any): any;
        stringify(value: any, replacer?: (this: any, key: string, value: any) => any, space?: string | number): string;
        stringify(value: any, replacer?: (number | string)[] | null, space?: string | number): string;
    };

    // Add Math
    declare var Math: {
        E: number;
        LN10: number;
        LN2: number;
        LOG10E: number;
        LOG2E: number;
        PI: number;
        SQRT1_2: number;
        SQRT2: number;
        abs(x: number): number;
        acos(x: number): number;
        asin(x: number): number;
        atan(x: number): number;
        atan2(y: number, x: number): number;
        ceil(x: number): number;
        cos(x: number): number;
        exp(x: number): number;
        floor(x: number): number;
        log(x: number): number;
        max(...values: number[]): number;
        min(...values: number[]): number;
        pow(x: number, y: number): number;
        random(): number;
        round(x: number): number;
        sin(x: number): number;
        sqrt(x: number): number;
        tan(x: number): number;
    };

    // Add basic DOM types
    interface Element {
        tagName: string;
        className: string;
        id: string;
        innerHTML: string;
        textContent: string | null;
        getAttribute(name: string): string | null;
        setAttribute(name: string, value: string): void;
        removeAttribute(name: string): void;
        addEventListener(type: string, listener: EventListener, options?: boolean | AddEventListenerOptions): void;
        removeEventListener(type: string, listener: EventListener, options?: boolean | EventListenerOptions): void;
        querySelector(selectors: string): Element | null;
        querySelectorAll(selectors: string): NodeList;
        appendChild(newChild: Node): Node;
        removeChild(oldChild: Node): Node;
        insertBefore(newChild: Node, refChild: Node | null): Node;
        cloneNode(deep?: boolean): Node;
        [key: string]: any;
    }

    interface Document {
        createElement(tagName: string): Element;
        getElementById(elementId: string): Element | null;
        querySelector(selectors: string): Element | null;
        querySelectorAll(selectors: string): NodeList;
        body: Element;
        head: Element;
        title: string;
        [key: string]: any;
    }

    interface Window {
        document: Document;
        console: typeof console;
        JSON: typeof JSON;
        Math: typeof Math;
        setTimeout(handler: TimerHandler, timeout?: number, ...arguments: any[]): number;
        clearTimeout(handle?: number): void;
        setInterval(handler: TimerHandler, timeout?: number, ...arguments: any[]): number;
        clearInterval(handle?: number): void;
        alert(message?: any): void;
        confirm(message?: string): boolean;
        prompt(message?: string, defaultText?: string): string | null;
        [key: string]: any;
    }

    declare var window: Window;
    declare var document: Document;

    // Add basic event types
    interface Event {
        type: string;
        target: EventTarget | null;
        currentTarget: EventTarget | null;
        preventDefault(): void;
        stopPropagation(): void;
        [key: string]: any;
    }

    interface EventTarget {
        addEventListener(type: string, listener: EventListener | null, options?: boolean | AddEventListenerOptions): void;
        removeEventListener(type: string, listener: EventListener | null, options?: boolean | EventListenerOptions): void;
        dispatchEvent(event: Event): boolean;
    }

    interface EventListener {
        (evt: Event): void;
    }

    interface AddEventListenerOptions {
        capture?: boolean;
        once?: boolean;
        passive?: boolean;
    }

    interface EventListenerOptions {
        capture?: boolean;
    }

    type TimerHandler = string | Function;

    interface Node {
        nodeType: number;
        nodeName: string;
        nodeValue: string | null;
        parentNode: Node | null;
        childNodes: NodeList;
        firstChild: Node | null;
        lastChild: Node | null;
        previousSibling: Node | null;
        nextSibling: Node | null;
        appendChild(newChild: Node): Node;
        removeChild(oldChild: Node): Node;
        insertBefore(newChild: Node, refChild: Node | null): Node;
        cloneNode(deep?: boolean): Node;
        [key: string]: any;
    }

    interface NodeList {
        length: number;
        item(index: number): Node | null;
        [index: number]: Node;
        forEach(callbackfn: (value: Node, key: number, parent: NodeList) => void, thisArg?: any): void;
    }
}
`;

        // Add the comprehensive types to Monaco
        monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(
            comprehensiveTypes,
            'file:///node_modules/@types/react/index.d.ts'
        );

        monacoInstance.languages.typescript.javascriptDefaults.addExtraLib(
            comprehensiveTypes,
            'file:///node_modules/@types/react/index.d.ts'
        );

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
