import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * How far the keyboard reaches above the navigation bar on Android, 0 while it's closed (and always on iOS, where
 * KeyboardAvoidingView does the job). Android draws the app edge to edge, so it no longer shrinks the screen for the
 * keyboard: whatever sits at the bottom has to move up by this much itself.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    // Sent again when the keyboard changes height (the emoji panel, say), so the height stays right.
    const shown = Keyboard.addListener('keyboardDidShow', (event) => setHeight(event.endCoordinates.height));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return height;
}
