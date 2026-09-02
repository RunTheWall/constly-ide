/**
 * Build-time constant from esbuild.mjs `define`. `false` in every shipped
 * bundle (the guarded code is dead-code-eliminated); `true` only in the
 * poisoned bundle the activation self-test builds to prove the E4 test can
 * fail. There is no runtime switch on purpose.
 */
declare const __CONSTLY_ACTIVATION_PROBE__: boolean;
