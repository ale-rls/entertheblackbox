import { requireOptionalNativeModule } from 'expo';

export const ShowScreen = requireOptionalNativeModule<{
  setActive(active: boolean): Promise<void>;
  pin(): Promise<void>;
}>('ShowScreen');
