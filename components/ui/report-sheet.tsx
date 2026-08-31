import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Palette, Radius, Spacing, Typo } from "@/constants/theme";
import { REPORT_REASONS, ReportReason } from "@/store/useStore";

const DETAIL_MAX = 200;

interface ReportSheetProps {
  visible: boolean;
  onClose: () => void;
  /** 신고 대상 이름 (사람 이름 또는 채팅방 이름) */
  targetName: string;
  /** 사람인지 방 전체인지에 따라 안내 문구가 달라진다 */
  targetType?: "USER" | "ROOM";
  /** 함께 차단할지 물어볼 대상이면 true */
  canBlock?: boolean;
  onSubmit: (payload: {
    reason: ReportReason;
    detail: string;
    alsoBlock: boolean;
  }) => void;
}

/**
 * 신고 사유를 고르고 상황을 덧붙이는 시트.
 * 사유를 고르기 전에는 접수 버튼이 눌리지 않게 해서 빈 신고를 막는다.
 */
export function ReportSheet({
  visible,
  onClose,
  targetName,
  targetType = "USER",
  canBlock = false,
  onSubmit,
}: ReportSheetProps) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(canBlock);

  // 다시 열었을 때 지난 신고 내용이 남아있으면 곤란하다
  useEffect(() => {
    if (visible) {
      setReason(null);
      setDetail("");
      setAlsoBlock(canBlock);
    }
  }, [visible, canBlock]);

  // 여기는 일부러 비속어 필터(utils/profanity)를 걸지 않는다.
  //
  // 신고자는 "상대가 ○○라고 했어요"처럼 당한 말을 그대로 옮겨 적어야 한다.
  // 그걸 막으면 정작 욕설 신고를 못 하게 되어 필터가 가해자를 돕는 꼴이 된다.
  // 이 글은 운영팀만 보고 다른 사용자에게는 노출되지 않으므로 걸러야 할 이유도 없다.
  const submit = () => {
    if (!reason) return;
    onSubmit({ reason, detail: detail.trim(), alsoBlock });
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="신고하기"
      description={
        (targetType === "USER"
          ? `${targetName} 님을 신고합니다.`
          : `'${targetName}' 채팅방을 신고합니다.`) +
        "\n신고 내용은 운영팀만 확인하며, 상대방에게는 알려지지 않아요."
      }
    >
      <ScrollView
        style={styles.reasonScroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionLabel}>어떤 문제가 있었나요?</Text>

        {REPORT_REASONS.map((item) => {
          const selected = reason === item.value;
          return (
            <Pressable
              key={item.value}
              onPress={() => setReason(item.value)}
              style={({ pressed }) => [
                styles.reasonRow,
                selected && styles.reasonRowSelected,
                pressed && !selected && { backgroundColor: Palette.gray50 },
              ]}
            >
              <View style={styles.reasonText}>
                <Text
                  style={[
                    styles.reasonLabel,
                    selected && { color: Palette.brandText },
                  ]}
                >
                  {item.label}
                </Text>
                <Text style={styles.reasonDesc}>{item.desc}</Text>
              </View>
              <View style={[styles.radio, selected && styles.radioSelected]}>
                {selected && (
                  <Ionicons name="checkmark" size={13} color={Palette.white} />
                )}
              </View>
            </Pressable>
          );
        })}

        <Text style={[styles.sectionLabel, { marginTop: Spacing.xl }]}>
          자세한 내용 <Text style={styles.optional}>(선택)</Text>
        </Text>
        <TextInput
          style={styles.detailInput}
          value={detail}
          onChangeText={(t) => setDetail(t.slice(0, DETAIL_MAX))}
          placeholder="언제, 어떤 일이 있었는지 적어주시면 처리에 도움이 돼요."
          placeholderTextColor={Palette.gray400}
          multiline
          textAlignVertical="top"
        />
        <Text style={styles.counter}>
          {detail.length}/{DETAIL_MAX}
        </Text>

        {canBlock && (
          <Pressable
            style={styles.blockToggle}
            onPress={() => setAlsoBlock((v) => !v)}
          >
            <View style={[styles.checkbox, alsoBlock && styles.checkboxOn]}>
              {alsoBlock && (
                <Ionicons name="checkmark" size={14} color={Palette.white} />
              )}
            </View>
            <Text style={styles.blockToggleText}>
              신고와 함께 이 사용자를 차단할래요
            </Text>
          </Pressable>
        )}
      </ScrollView>

      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.cancel, pressed && { opacity: 0.6 }]}
          onPress={onClose}
        >
          <Text style={styles.cancelText}>취소</Text>
        </Pressable>
        <Pressable
          disabled={!reason}
          onPress={submit}
          style={({ pressed }) => [
            styles.submit,
            !reason && styles.submitDisabled,
            pressed && reason && { opacity: 0.85 },
          ]}
        >
          <Text style={styles.submitText}>신고 접수하기</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  // 사유가 6개라 시트가 화면을 다 덮지 않도록 높이를 제한한다
  reasonScroll: { maxHeight: 380, marginTop: Spacing.xl },

  sectionLabel: {
    ...Typo.section,
    marginBottom: Spacing.sm,
  },
  optional: { ...Typo.caption, fontWeight: "500" },

  reasonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Palette.gray200,
    marginBottom: Spacing.sm,
  },
  reasonRowSelected: {
    borderColor: Palette.brand,
    backgroundColor: Palette.brandWeak,
  },
  reasonText: { flex: 1 },
  reasonLabel: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.gray900,
  },
  reasonDesc: { ...Typo.caption, fontSize: 12, marginTop: 2 },

  radio: {
    width: 22,
    height: 22,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    borderColor: Palette.gray300,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: {
    backgroundColor: Palette.brand,
    borderColor: Palette.brand,
  },

  detailInput: {
    minHeight: 88,
    borderRadius: Radius.md,
    backgroundColor: Palette.gray100,
    padding: Spacing.lg,
    fontSize: 15,
    letterSpacing: -0.3,
    color: Palette.gray900,
    lineHeight: 21,
  },
  counter: {
    ...Typo.caption,
    fontSize: 12,
    textAlign: "right",
    marginTop: 6,
  },

  blockToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: Palette.gray300,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: Palette.red, borderColor: Palette.red },
  blockToggleText: {
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: -0.3,
    color: Palette.gray700,
  },

  actions: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  cancel: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: Radius.md,
    backgroundColor: Palette.gray100,
    alignItems: "center",
  },
  cancelText: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.gray700,
  },
  submit: {
    flex: 2,
    paddingVertical: 16,
    borderRadius: Radius.md,
    backgroundColor: Palette.red,
    alignItems: "center",
  },
  submitDisabled: { backgroundColor: Palette.gray200 },
  submitText: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.white,
  },
});
