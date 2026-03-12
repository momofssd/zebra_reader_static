declare global {
    var Go: new () => {
        argv: string[];
        env: Record<string, string>;
        importObject: WebAssembly.Imports;
        run: (inst: WebAssembly.Instance) => Promise<void>;
    };
}
type InitOptions<TApi> = {
    argv?: string[];
    env?: Record<string, string>;
    /** e.g. "zpl" if your Go sets globalThis.zpl = {...} */
    namespace?: string;
    imports?: WebAssembly.Imports;
};
export declare function initGoWasm<TApi = Record<string, unknown>>(opts?: InitOptions<TApi>): Promise<{
    instance: WebAssembly.Instance;
    api: TApi | undefined;
    done: Promise<void>;
}>;
export {};
