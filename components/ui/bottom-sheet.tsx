import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Hairline, Palette, Radius, Shadow, Spacing, Typo } from "@/constants/theme";

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
}

/**
 * 아래에서 올라오는 시트. 프로필 아바타 시트와 같은 문법을 컴포넌트로 뽑았다.
 * 배경을 누르면 닫히고, 홈 인디케이터 높이만큼 아래 여백을 확보한다.
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  description,
  children,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      {/* 시트 안에 입력창이 있어도 키보드에 가려지지 않게 감싼다 */}
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View
          style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}
        >
          <View style={styles.handle} />
          {!!title && <Text style={styles.title}>{title}</Text>}
          {!!description && (
            <Text style={styles.description}>{description}</Text>
          )}
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

interface SheetActionProps {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  description?: string;
  /** danger는 신고·차단처럼 되돌리기 부담이 있는 항목에만 */
  tone?: "default" | "danger";
  onPress: () => void;
}

/** 시트 안에 들어가는 액션 한 줄. */
export function SheetAction({
  icon,
  label,
  description,
  tone = "default",
  onPress,
}: SheetActionProps) {
  const color = tone === "danger" ? Palette.red : Palette.gray800;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        pressed && { backgroundColor: Palette.gray50 },
      ]}
    >
      <View
        style={[
          styles.actionIcon,
          { backgroundColor: tone === "danger" ? Palette.redWeak : Palette.gray100 },
        ]}
      >
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <View style={styles.actionText}>
        <Text style={[styles.actionLabel, { color }]}>{label}</Text>
        {!!description && (
          <Text style={styles.actionDesc}>{description}</Text>
        )}
      </View>
    </Pressable>
  );
}

/** 시트를 그냥 닫는 회색 버튼. */
export function SheetCancel({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.cancel, pressed && { opacity: 0.6 }]}
    >
      <Text style={styles.cancelText}>닫기</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(11,18,32,0.5)",
  },
  sheet: {
    backgroundColor: Palette.white,
    borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl,
    paddingHorizontal: Spacing.screen,
    paddingTop: Spacing.md,
    ...Shadow.modal,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: Radius.full,
    backgroundColor: Palette.gray200,
    marginBottom: Spacing.xl,
  },
  title: Typo.title,
  description: {
    ...Typo.caption,
    marginTop: 6,
    lineHeight: 19,
  },

  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    marginTop: Spacing.sm,
    borderRadius: Radius.md,
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: { flex: 1 },
  actionLabel: {
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: -0.3,
  },
  actionDesc: { ...Typo.caption, fontSize: 12, marginTop: 2 },

  cancel: {
    marginTop: Spacing.md,
    paddingVertical: 16,
    borderRadius: Radius.md,
    backgroundColor: Palette.gray100,
    alignItems: "center",
    borderWidth: Hairline.height,
    borderColor: "transparent",
  },
  cancelText: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.gray700,
  },
});
