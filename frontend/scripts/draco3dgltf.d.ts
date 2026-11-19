declare module 'draco3dgltf' {
  /** Emscripten module instances; gltf-transform treats them as opaque dependencies. */
  const draco3d: {
    createDecoderModule(): Promise<unknown>;
    createEncoderModule(): Promise<unknown>;
  };
  export default draco3d;
}
