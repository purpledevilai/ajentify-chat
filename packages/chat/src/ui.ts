// Top-level UI surface
export { ChatView, type ChatViewProps, type ChatViewClassNames } from './components/ChatView';
export {
  ChatPanel,
  type ChatPanelProps,
  type ChatPanelClassNames,
} from './components/ChatPanel';
export {
  ChatHeader,
  type ChatHeaderProps,
  type ChatHeaderClassNames,
} from './components/ChatHeader';
export {
  ChatMessages,
  type ChatMessagesProps,
  type ChatMessagesClassNames,
} from './components/ChatMessages';
export { ChatInput, type ChatInputProps, type ChatInputClassNames } from './components/ChatInput';
export {
  ChatHistory,
  type ChatHistoryProps,
  type ChatHistoryClassNames,
} from './components/ChatHistory';
export { Message, type MessageProps, type MessageClassNames } from './components/Message';
export { TypingText, type TypingTextProps } from './components/TypingText';
export {
  ChatToggleButton,
  type ChatToggleButtonProps,
} from './components/ChatToggleButton';

// Primitives (re-exported for advanced composition)
export {
  Button,
  type ButtonProps,
  type ButtonVariant,
  type ButtonSize,
} from './components/primitives/Button';
export { IconButton, type IconButtonProps } from './components/primitives/IconButton';
export { Textarea, type TextareaProps } from './components/primitives/Textarea';
export { ScrollArea } from './components/primitives/ScrollArea';
export {
  Sheet,
  SheetContent,
  SheetClose,
  SheetOverlay,
  SheetPortal,
  SheetTrigger,
} from './components/primitives/Sheet';
