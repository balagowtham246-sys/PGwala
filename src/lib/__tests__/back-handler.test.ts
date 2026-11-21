import { BackHandler } from 'react-native';

import {
  createModalBackPressHandler,
  useModalBackHandler,
} from '@/hooks/use-modal-back-handler';
import {
  createTabsBackPressHandler,
  HOME_TAB_INDEX,
} from '@/components/swipeable-tabs-shell';

const mockUseEffectCallbacks: (() => void | (() => void))[] = [];

jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useEffect: (fn: () => void | (() => void)) => {
      mockUseEffectCallbacks.push(fn);
    },
  };
});

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
}));

jest.mock('react-native-pager-view', () => 'PagerView');

jest.mock('@/components/ui/bottom-nav', () => ({
  RoleBottomNav: () => null,
}));

describe('Android hardware BackHandler edge cases', () => {
  beforeEach(() => {
    mockUseEffectCallbacks.length = 0;
    jest.restoreAllMocks();
  });

  describe('SwipeableTabsShell BackHandler', () => {
    it('navigates back to Home when user is on any non-Home tab (maintenance/menu/gate/bill)', () => {
      for (const nonHomeIndex of [0, 1, 3, 4]) {
        const onReturnHome = jest.fn();
        const handler = createTabsBackPressHandler(
          () => nonHomeIndex,
          onReturnHome
        );

        const handled = handler();
        expect(handled).toBe(true);
        expect(onReturnHome).toHaveBeenCalledTimes(1);
      }
    });

    it('lets OS handle Back when already on the Home tab', () => {
      const onReturnHome = jest.fn();
      const handler = createTabsBackPressHandler(
        () => HOME_TAB_INDEX,
        onReturnHome
      );

      const handled = handler();
      expect(handled).toBe(false);
      expect(onReturnHome).not.toHaveBeenCalled();
    });
  });

  describe('useModalBackHandler & modal dismiss behavior', () => {
    it('closes modal and consumes hardwareBackPress when not disabled', () => {
      const onClose = jest.fn();
      const handler = createModalBackPressHandler(onClose, false);

      expect(handler()).toBe(true);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('blocks dismiss while submitting/busy yet still consumes hardwareBackPress', () => {
      const onClose = jest.fn();
      const handler = createModalBackPressHandler(onClose, true);

      expect(handler()).toBe(true);
      expect(onClose).not.toHaveBeenCalled();
    });

    it('registers and removes BackHandler listener based on modal visibility', () => {
      const removeSpy = jest.fn();
      const addSpy = jest
        .spyOn(BackHandler, 'addEventListener')
        .mockReturnValue({ remove: removeSpy } as unknown as ReturnType<
          typeof BackHandler.addEventListener
        >);
      const onClose = jest.fn();

      // Hidden modal -> no listener registered
      useModalBackHandler(false, onClose);
      expect(mockUseEffectCallbacks).toHaveLength(1);
      const hiddenCleanup = mockUseEffectCallbacks[0]();
      expect(addSpy).not.toHaveBeenCalled();
      expect(hiddenCleanup).toBeUndefined();

      // Visible modal -> registers listener and triggers onClose on back press
      useModalBackHandler(true, onClose);
      expect(mockUseEffectCallbacks).toHaveLength(2);
      const cleanup = mockUseEffectCallbacks[1]();
      expect(addSpy).toHaveBeenCalledTimes(1);
      expect(addSpy.mock.calls[0][0]).toBe('hardwareBackPress');

      const registeredHandler = addSpy.mock.calls[0][1] as () => boolean | null | undefined;
      expect(registeredHandler()).toBe(true);
      expect(onClose).toHaveBeenCalledTimes(1);

      if (typeof cleanup === 'function') cleanup();
      expect(removeSpy).toHaveBeenCalledTimes(1);
    });
  });
});
