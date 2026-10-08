#import <HealthSyncSpec/HealthSyncSpec.h>

NS_ASSUME_NONNULL_BEGIN

/// Turbo Module implementing the protocol that codegen generated from
/// src/specs/NativeHealthSync.ts. It's linked to the JS name
/// "NativeHealthSync" through `codegenConfig.ios.modulesProvider` in package.json.
/// Subclassing NativeHealthSyncSpecBase gives us `emitOnHealthEvent:`.
@interface RCTNativeHealthSync : NativeHealthSyncSpecBase <NativeHealthSyncSpec>
@end

NS_ASSUME_NONNULL_END
