// 파일: app/settings/notifications.tsx
//
// 알림 설정 — 종류별로 켜고 끈다.
//
// 서버는 '끈 것'만 저장한다(notification_mutes, 마이그레이션 014). 그래서
// 이 화면이 들고 있는 것도 켜진 목록이 아니라 꺼진 종류의 집합이다.
// 처음 들어온 사람은 빈 집합 = 전부 켜짐이다.
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";

import { API } from "@/api/client";
import { Divider, NavHeader, Screen } from "@/components/ui/screen";
import { Palette, Radius, Spacing, Typo } from "@/constants/theme";
import type { NotificationKind } from "@/store/useStore";
import {
  isGroupEnabled,
  NOTIFICATION_GROUPS,
  type NotificationGroup,
} from "@/utils/notifications";

export default function NotificationSettingsScreen() {
  const router = useRouter();

  const [mutedKinds, setMutedKinds] = useState<Set<NotificationKind>>(
    () => new Set(),
  );
  const [isLoading, setIsLoading] = useState(true);
  /** 저장 중인 묶음. 응답을 기다리는 동안 그 스위치만 잠근다. */
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await API.getNotificationMutes();
    if (result.code !== 200 || !result.data) {
      // 401(세션 만료)은 _layout.tsx 가 로그인 화면으로 보내므로 조용히 둔다.
      if (result.code !== 401) {
        Alert.alert("오류", result.message ?? "설정을 불러오지 못했어요.");
      }
      return;
    }
    setMutedKinds(new Set(result.data));
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      await load();
      if (alive) setIsLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  /**
   * 스위치 하나를 뒤집는다.
   *
   * 먼저 그리고 나중에 저장한다. 스위치는 누른 즉시 움직여야 눌린 느낌이
   * 나는데, 여기서만은 실패하면 반드시 되돌린다 — 껐다고 생각한 알림이
   * 계속 오는 것만큼 나쁜 게 없다.
   */
  const toggleGroup = async (group: NotificationGroup, enabled: boolean) => {
    if (savingKey) return;

    const before = mutedKinds;
    const next = new Set(before);
    for (const kind of group.kinds) {
      if (enabled) next.delete(kind);
      else next.add(kind);
    }

    setMutedKinds(next);
    setSavingKey(group.key);

    const result = await API.setNotificationMuted(group.kinds, !enabled);

    setSavingKey(null);
    if (result.code !== 200) {
      setMutedKinds(before);
      if (result.code !== 401) {
        Alert.alert("오류", result.message ?? "설정을 저장하지 못했어요.");
      }
    }
  };

  const renderRow = (group: NotificationGroup, isLast: boolean) => {
    const enabled = isGroupEnabled(group, mutedKinds);

    return (
      <View key={group.key}>
        <View style={styles.row}>
          <View style={styles.iconCircle}>
            <Ionicons name={group.icon} size={20} color={Palette.gray600} />
          </View>

          <View style={styles.rowBody}>
            <Text style={styles.label}>{group.label}</Text>
            <Text style={styles.description}>{group.description}</Text>
          </View>

          <Switch
            value={enabled}
            onValueChange={(value) => toggleGroup(group, value)}
            disabled={savingKey !== null}
            trackColor={{ false: Palette.gray200, true: Palette.brand }}
            thumbColor={Palette.white}
            ios_backgroundColor={Palette.gray200}
          />
        </View>
        {!isLast && <Divider inset={68} />}
      </View>
    );
  };

  return (
    <Screen tone="grouped">
      <NavHeader title="알림 설정" onBack={() => router.back()} />

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={Palette.brand} />
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          <View style={styles.notice}>
            <Ionicons
              name="information-circle-outline"
              size={16}
              color={Palette.gray500}
            />
            <Text style={styles.noticeText}>
              끈 알림은 알림함에도 쌓이지 않아요. 받은 신청과 매칭 기록은
              [활동] 탭에서 계속 볼 수 있어요.
            </Text>
          </View>

          <View style={styles.card}>
            {NOTIFICATION_GROUPS.map((group, index) =>
              renderRow(group, index === NOTIFICATION_GROUPS.length - 1),
            )}
          </View>

          {/*
            공지는 끄지 못한다. 점검 안내나 안전 공지처럼 못 보면 곤란한
            것만 이 종류로 나간다. 스위치를 아예 안 그리면 "왜 공지는 없지"
            가 되므로, 잠긴 채로 보여주고 이유를 적는다.
          */}
          <View style={[styles.card, styles.cardGap]}>
            <View style={styles.row}>
              <View style={styles.iconCircle}>
                <Ionicons
                  name="megaphone-outline"
                  size={20}
                  color={Palette.gray400}
                />
              </View>

              <View style={styles.rowBody}>
                <Text style={[styles.label, { color: Palette.gray500 }]}>
                  서비스 공지
                </Text>
                <Text style={styles.description}>
                  점검·안전 안내는 끌 수 없어요
                </Text>
              </View>

              <Switch
                value
                disabled
                trackColor={{ false: Palette.gray200, true: Palette.gray300 }}
                thumbColor={Palette.white}
                ios_backgroundColor={Palette.gray200}
              />
            </View>
          </View>

          {/*
            푸시는 아직 없다(마이그레이션 013 보류). 여기 설정은 앱 안의
            알림함에만 적용된다는 걸 미리 말해 두지 않으면, 잠금화면에
            아무것도 안 뜨는 걸 설정 탓으로 오해한다.
          */}
          <Text style={styles.footnote}>
            지금은 앱 안에서만 알림을 보여드려요. 잠금화면 알림은 준비 중이에요.
          </Text>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },

  content: { paddingBottom: Spacing.xxxl },

  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    paddingHorizontal: Spacing.screen,
    paddingVertical: Spacing.lg,
    backgroundColor: Palette.brandWeak,
  },
  noticeText: {
    ...Typo.caption,
    flex: 1,
    lineHeight: 19,
  },

  card: {
    backgroundColor: Palette.white,
  },
  cardGap: { marginTop: Spacing.gap },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.screen,
    paddingVertical: Spacing.lg,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    backgroundColor: Palette.gray100,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: { flex: 1 },
  label: { ...Typo.section, fontSize: 15 },
  description: { ...Typo.caption, fontSize: 12, marginTop: 2 },

  footnote: {
    ...Typo.caption,
    fontSize: 12,
    color: Palette.gray500,
    textAlign: "center",
    marginTop: Spacing.xl,
    paddingHorizontal: Spacing.screen,
    lineHeight: 18,
  },
});
