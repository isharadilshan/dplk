package com.testhello.healthsync

import com.facebook.fbreact.specs.NativeHealthSyncSpec
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Registers HealthSyncModule with React Native. Added by hand in
 * MainApplication, because autolinking only covers modules from node_modules.
 */
class HealthSyncPackage : BaseReactPackage() {

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
      if (name == NativeHealthSyncSpec.NAME) HealthSyncModule(reactContext) else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
        NativeHealthSyncSpec.NAME to
            ReactModuleInfo(
                name = NativeHealthSyncSpec.NAME,
                className = NativeHealthSyncSpec.NAME,
                canOverrideExistingModule = false,
                needsEagerInit = false,
                isCxxModule = false,
                isTurboModule = true,
            ))
  }
}
