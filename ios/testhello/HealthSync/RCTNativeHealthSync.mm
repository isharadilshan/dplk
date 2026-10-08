#import "RCTNativeHealthSync.h"

// The generated Swift header below declares EVERY @objc class in the app
// target, so the frameworks their superclasses/protocols come from must be
// imported first: WatchConnectivity (WatchSessionManager is a
// WCSessionDelegate) and RN's app delegate (the template's ReactNativeDelegate).
#import <React/RCTDefaultReactNativeFactoryDelegate.h>
#import <WatchConnectivity/WatchConnectivity.h>

// Header Xcode generates so ObjC can see our @objc Swift classes.
#import "testhello-Swift.h"

/// Thin ObjC++ adapter: converts Turbo Module calls (promise blocks) into
/// calls on the Swift HealthSyncBridge, which holds the real logic.
@implementation RCTNativeHealthSync

+ (NSString *)moduleName
{
  return @"NativeHealthSync";
}

- (instancetype)init
{
  if (self = [super init]) {
    // Forward native log entries to JS while this module exists. The weak
    // reference avoids a retain cycle with the long-lived Swift singleton.
    __weak RCTNativeHealthSync *weakSelf = self;
    HealthSyncBridge.shared.eventListener = ^(NSDictionary<NSString *, id> *entry) {
      [weakSelf emitOnHealthEvent:entry];
    };
  }
  return self;
}

- (void)invalidate
{
  // JS runtime is going away (reload or teardown), so stop forwarding events.
  HealthSyncBridge.shared.eventListener = nil;
}

// Connects this ObjC class to the C++ JSI bindings that codegen generated.
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeHealthSyncSpecJSI>(params);
}

#pragma mark - Spec methods

- (void)requestHealthPermissions:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [HealthSyncBridge.shared requestHealthPermissions:^(BOOL ok, NSString *_Nullable error) {
    error ? reject(@"E_HEALTHKIT", error, nil) : resolve(@(ok));
  }];
}

- (void)schedulePeriodicSync:(double)intervalMinutes
                     resolve:(RCTPromiseResolveBlock)resolve
                      reject:(RCTPromiseRejectBlock)reject
{
  [HealthSyncBridge.shared schedulePeriodicSync:intervalMinutes];
  resolve(nil);
}

- (void)runSyncNow:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [HealthSyncBridge.shared runSyncNow:^{
    resolve(nil);
  }];
}

- (void)cancelScheduledWork:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [HealthSyncBridge.shared cancelScheduledWork];
  resolve(nil);
}

- (void)enableHealthBackgroundDelivery:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [HealthSyncBridge.shared enableBackgroundDelivery:^(BOOL ok, NSString *_Nullable error) {
    error ? reject(@"E_HEALTHKIT", error, nil) : resolve(@(ok));
  }];
}

- (void)startLiveSession:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [HealthSyncBridge.shared startLiveSession:^(BOOL ok, NSString *_Nullable error) {
    error ? reject(@"E_SESSION", error, nil) : resolve(nil);
  }];
}

- (void)stopLiveSession:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [HealthSyncBridge.shared stopLiveSession];
  resolve(nil);
}

- (void)getWearableStatus:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  resolve([HealthSyncBridge.shared wearableStatus]);
}

- (void)simulateWearableSample:(double)bpm
{
  [HealthSyncBridge.shared simulateWearableSample:bpm];
}

- (void)getPendingSampleCount:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  resolve(@([HealthSyncBridge.shared pendingSampleCount]));
}

- (void)getActivityLog:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  resolve([HealthSyncBridge.shared activityLog]);
}

- (void)clearActivityLog:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [HealthSyncBridge.shared clearActivityLog];
  resolve(nil);
}

@end
