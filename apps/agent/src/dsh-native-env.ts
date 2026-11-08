// Host-owned runtime policy: native modules load from the immutable trusted image.
// The upstream loader's default /tmp copy is incompatible with noexec service scratch.
// Never read this switch from visitor input or forward a parent override.
export const DSH_NATIVE_READONLY_ENV = Object.freeze({ NARB_DISABLE_NATIVE_CACHE: '1' });
