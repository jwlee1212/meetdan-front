import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Chip } from "@/components/ui/chip";
import { Palette, Radius, Spacing, Typo } from "@/constants/theme";
import type { ConfirmedPlan } from "@/store/useStore";
import { toDateString } from "@/utils/plan";
import { assertClean } from "@/utils/profanity";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const PLACE_MAX = 30;
const PLACE_SUGGESTIONS = ["죽전역 근처", "보정동 카페거리", "천안 신부동", "학교 정문"];

/** 만남 시간대만 고르면 되니 09:00~23:30을 30분 단위로 */
const TIME_SLOTS = Array.from({ length: 30 }, (_, i) => {
  const total = 9 * 60 + i * 30;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
    total % 60,
  ).padStart(2, "0")}`;
});

const DATE_ITEM_WIDTH = 56 + Spacing.sm;
const TIME_ITEM_WIDTH = 72 + Spacing.sm;

interface PlanSheetProps {
  visible: boolean;
  onClose: () => void;
  /** 이미 잡힌 약속이 있으면 그 값에서 시작한다 */
  initialPlan?: ConfirmedPlan;
  onSubmit: (plan: ConfirmedPlan) => void;
  onRemove?: () => void;
}

/**
 * 날짜·시간·장소를 직접 골라 약속을 확정하는 시트.
 * 대화 내용을 파싱하지 않고, 유저가 원할 때만 연다.
 */
export function PlanSheet({
  visible,
  onClose,
  initialPlan,
  onSubmit,
  onRemove,
}: PlanSheetProps) {
  // 오늘부터 60일. 날짜가 바뀌어도 어긋나지 않게 열릴 때마다 다시 만든다.
  const days = useMemo(() => {
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    return Array.from({ length: 60 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return d;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const [date, setDate] = useState(() => toDateString(days[0]));
  const [time, setTime] = useState("19:00");
  const [place, setPlace] = useState("");

  const dateScroll = useRef<ScrollView>(null);
  const timeScroll = useRef<ScrollView>(null);

  useEffect(() => {
    if (!visible) return;

    const nextDate = initialPlan?.date ?? toDateString(days[0]);
    const nextTime = initialPlan?.time ?? "19:00";
    setDate(nextDate);
    setTime(nextTime);
    setPlace(initialPlan?.place ?? "");

    // 고른 값이 화면 밖에 있으면 못 보고 지나친다. 열릴 때 맞춰서 밀어준다.
    const dateIndex = days.findIndex((d) => toDateString(d) === nextDate);
    const timeIndex = TIME_SLOTS.indexOf(nextTime);
    const t = setTimeout(() => {
      if (dateIndex > 1) {
        dateScroll.current?.scrollTo({
          x: (dateIndex - 1) * DATE_ITEM_WIDTH,
          animated: false,
        });
      }
      if (timeIndex > 1) {
        timeScroll.current?.scrollTo({
          x: (timeIndex - 1) * TIME_ITEM_WIDTH,
          animated: false,
        });
      }
    }, 60);
    return () => clearTimeout(t);
  }, [visible, initialPlan, days]);

  // 장소는 확정되면 채팅방 배너로 올라가 양쪽 팀 모두에게 보인다
  const submit = () => {
    const trimmed = place.trim();
    if (!assertClean({ 장소: trimmed })) return;
    onSubmit({ date, time, place: trimmed });
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={initialPlan ? "약속 수정하기" : "약속 잡기"}
      description="정한 날짜와 장소를 적어두면 서로 헷갈리지 않아요."
    >
      <ScrollView
        style={styles.body}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── 날짜 ─────────────────────────── */}
        <Text style={styles.label}>날짜</Text>
        <ScrollView
          ref={dateScroll}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}
        >
          {days.map((d, index) => {
            const value = toDateString(d);
            const selected = value === date;
            const isSunday = d.getDay() === 0;
            const isSaturday = d.getDay() === 6;

            return (
              <Pressable
                key={value}
                onPress={() => setDate(value)}
                style={[styles.dateCell, selected && styles.dateCellSelected]}
              >
                <Text
                  style={[
                    styles.dateWeekday,
                    isSunday && { color: Palette.red },
                    isSaturday && { color: Palette.brand },
                    selected && styles.dateTextSelected,
                  ]}
                >
                  {index === 0
                    ? "오늘"
                    : index === 1
                      ? "내일"
                      : WEEKDAYS[d.getDay()]}
                </Text>
                <Text
                  style={[styles.dateDay, selected && styles.dateTextSelected]}
                >
                  {d.getDate()}
                </Text>
                <Text
                  style={[
                    styles.dateMonth,
                    selected && styles.dateTextSelected,
                  ]}
                >
                  {d.getMonth() + 1}월
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* ── 시간 ─────────────────────────── */}
        <Text style={styles.label}>시간</Text>
        <ScrollView
          ref={timeScroll}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}
        >
          {TIME_SLOTS.map((slot) => {
            const selected = slot === time;
            return (
              <Pressable
                key={slot}
                onPress={() => setTime(slot)}
                style={[styles.timeCell, selected && styles.timeCellSelected]}
              >
                <Text
                  style={[styles.timeText, selected && styles.timeTextSelected]}
                >
                  {slot}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* ── 장소 ─────────────────────────── */}
        <Text style={styles.label}>
          장소 <Text style={styles.optional}>(선택)</Text>
        </Text>
        <TextInput
          style={styles.placeInput}
          value={place}
          onChangeText={(t) => setPlace(t.slice(0, PLACE_MAX))}
          placeholder="예) 죽전역 근처"
          placeholderTextColor={Palette.gray400}
          returnKeyType="done"
        />
        <View style={styles.suggestions}>
          {PLACE_SUGGESTIONS.map((s) => (
            <Chip
              key={s}
              label={s}
              selected={place === s}
              onPress={() => setPlace(place === s ? "" : s)}
            />
          ))}
        </View>
      </ScrollView>

      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.cancel, pressed && { opacity: 0.6 }]}
          onPress={onClose}
        >
          <Text style={styles.cancelText}>취소</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.submit, pressed && { opacity: 0.85 }]}
          onPress={submit}
        >
          <Text style={styles.submitText}>
            {initialPlan ? "약속 수정" : "약속 확정"}
          </Text>
        </Pressable>
      </View>

      {!!initialPlan && !!onRemove && (
        <Pressable
          onPress={onRemove}
          style={({ pressed }) => [styles.remove, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.removeText}>약속 취소하기</Text>
        </Pressable>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { maxHeight: 420, marginTop: Spacing.xl },

  label: {
    ...Typo.section,
    marginBottom: Spacing.sm,
  },
  optional: { ...Typo.caption, fontWeight: "500" },

  strip: { gap: Spacing.sm, paddingBottom: Spacing.xl, paddingRight: Spacing.lg },

  dateCell: {
    width: 56,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Palette.gray200,
    alignItems: "center",
    gap: 2,
  },
  dateCellSelected: {
    backgroundColor: Palette.brand,
    borderColor: Palette.brand,
  },
  dateWeekday: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: -0.2,
    color: Palette.gray500,
  },
  dateDay: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.4,
    color: Palette.gray900,
  },
  dateMonth: {
    fontSize: 10,
    fontWeight: "600",
    color: Palette.gray500,
  },
  dateTextSelected: { color: Palette.white },

  timeCell: {
    width: 72,
    paddingVertical: 10,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Palette.gray200,
    alignItems: "center",
  },
  timeCellSelected: {
    backgroundColor: Palette.brand,
    borderColor: Palette.brand,
  },
  timeText: {
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: -0.3,
    color: Palette.gray600,
  },
  timeTextSelected: { color: Palette.white, fontWeight: "700" },

  placeInput: {
    height: 52,
    borderRadius: Radius.md,
    backgroundColor: Palette.gray100,
    paddingHorizontal: Spacing.lg,
    fontSize: 15,
    letterSpacing: -0.3,
    color: Palette.gray900,
  },
  suggestions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },

  actions: { flexDirection: "row", gap: Spacing.sm, marginTop: Spacing.lg },
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
    backgroundColor: Palette.brand,
    alignItems: "center",
  },
  submitText: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.white,
  },

  remove: { alignItems: "center", paddingVertical: Spacing.md },
  removeText: {
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: -0.3,
    color: Palette.gray500,
    textDecorationLine: "underline",
  },
});
