// 파일: app/notifications.tsx
//
// 알림 센터. 홈 헤더의 종 아이콘에서 들어온다.
//
// 문구는 서버가 만들어 둔 것을 그대로 그린다(마이그레이션 012). 이 화면이
// 하는 일은 세 가지다 — 묶어서 보여주고, 읽음을 표시하고, 눌린 알림이
// 가리키는 화면으로 보내는 것.
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { API, toRelativeTime } from "@/api/client";
import { EmptyState } from "@/components/ui/empty-state";
import { PressScale } from "@/components/ui/press-scale";
import { NavHeader, Screen } from "@/components/ui/screen";
import { Palette, Radius, Spacing, Typo } from "@/constants/theme";
import {
  groupNotifications,
  notificationTarget,
  notificationView,
} from "@/utils/notifications";
import { AppNotification, useStore } from "@/store/useStore";

export default function NotificationsScreen() {
  const router = useRouter();

  const notifications = useStore((state) => state.notifications);
  const unreadCount = useStore((state) => state.unreadCount);
  const setNotifications = useStore((state) => state.setNotifications);
  const markReadLocally = useStore((state) => state.markNotificationRead);
  const markAllReadLocally = useStore((state) => state.markAllNotificationsRead);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  /**
   * 알림은 서버가 유일한 출처다. 화면에 있는 동안에도 _layout.tsx 의
   * Realtime 구독이 새 줄을 스토어에 밀어 넣으므로, 여기서는 들어올 때
   * 한 번 맞춰 두기만 하면 된다.
   */
  const reload = useCallback(async () => {
    const result = await API.getNotifications();
    if (result.code !== 200 || !result.data) {
      // 401(세션 만료)은 _layout.tsx 가 로그인 화면으로 보내므로 조용히 둔다.
      if (result.code !== 401) {
        Alert.alert("오류", result.message ?? "알림을 불러오지 못했어요.");
      }
      return;
    }
    setNotifications(result.data);
  }, [setNotifications]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        await reload();
        if (alive) setIsLoading(false);
      })();
      return () => {
        alive = false;
      };
    }, [reload]),
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await reload();
    setIsRefreshing(false);
  };

  const sections = useMemo(
    () => groupNotifications(notifications),
    [notifications],
  );

  /**
   * 하나 누르기 — 읽음으로 바꾸고 대상 화면으로 보낸다.
   *
   * 읽음 표시는 낙관적으로 먼저 그린다. 실패해도 되돌리지 않는다.
   * 다음에 목록을 다시 읽으면 서버 값으로 맞춰지고, 그 사이 잘못 보이는
   * 것은 뱃지 숫자 하나뿐이라 화면을 붙잡아 둘 만한 일이 아니다.
   */
  const handlePress = (item: AppNotification) => {
    if (!item.isRead) {
      markReadLocally(item.id);
      API.markNotificationRead(item.id);
    }

    const target = notificationTarget(item);
    if (!target) return;

    if (target.mode === "replace") router.replace(target.href as any);
    else router.push(target.href as any);
  };

  const handleMarkAll = async () => {
    if (unreadCount === 0) return;

    markAllReadLocally();
    const result = await API.markAllNotificationsRead();
    if (result.code !== 200 && result.code !== 401) {
      // 여기서는 되돌린다. '모두 읽음'은 사용자가 직접 누른 일이라
      // 안 됐으면 안 됐다고 말해야 한다.
      Alert.alert("오류", result.message ?? "읽음 표시에 실패했어요.");
      await reload();
    }
  };

  const renderItem = ({ item }: { item: AppNotification }) => {
    const view = notificationView(item.kind);
    const openable = notificationTarget(item) !== null;

    return (
      <PressScale
        scaleTo={0.98}
        // 갈 곳이 없는 알림(공지)은 눌러도 읽음 표시만 된다.
        style={[styles.row, !item.isRead && styles.rowUnread]}
        onPress={() => handlePress(item)}
      >
        <View style={[styles.iconCircle, { backgroundColor: view.bg }]}>
          <Ionicons name={view.icon} size={22} color={view.fg} />
        </View>

        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <Text style={styles.title} numberOfLines={1}>
              {item.title}
            </Text>
            {!item.isRead && <View style={styles.dot} />}
          </View>

          <Text style={styles.body} numberOfLines={2}>
            {item.body}
          </Text>
          <Text style={styles.time}>{toRelativeTime(item.createdAt)}</Text>
        </View>

        {openable && (
          <Ionicons
            name="chevron-forward"
            size={18}
            color={Palette.gray300}
            style={styles.chevron}
          />
        )}
      </PressScale>
    );
  };

  return (
    <Screen>
      <NavHeader
        title="알림"
        onBack={() => router.back()}
        right={
          <>
            {unreadCount > 0 && (
              <Pressable
                hitSlop={8}
                onPress={handleMarkAll}
                style={({ pressed }) => pressed && { opacity: 0.5 }}
              >
                <Text style={styles.markAll}>모두 읽음</Text>
              </Pressable>
            )}
            {/* 알림이 너무 잦다고 느끼는 곳이 바로 여기다. 마이 탭까지
                찾아 들어가지 않아도 되게 설정을 옆에 둔다. */}
            <Pressable
              hitSlop={8}
              onPress={() => router.push("/settings/notifications" as any)}
              style={({ pressed }) => [
                styles.settingsButton,
                pressed && { opacity: 0.5 },
              ]}
            >
              <Ionicons
                name="settings-outline"
                size={20}
                color={Palette.gray600}
              />
            </Pressable>
          </>
        }
      />

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={Palette.brand} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionTitle}>{section.title}</Text>
          )}
          stickySectionHeadersEnabled={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={Palette.brand}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="notifications-outline"
              title="아직 알림이 없어요"
              description={
                "매칭 신청이 오거나 약속이 정해지면\n여기로 알려드릴게요."
              }
            />
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },

  markAll: {
    ...Typo.caption,
    fontWeight: "700",
    color: Palette.brandText,
  },
  settingsButton: { paddingLeft: Spacing.sm, paddingVertical: 2 },

  listContent: { paddingBottom: Spacing.xxxl },

  sectionTitle: {
    ...Typo.label,
    color: Palette.gray500,
    paddingHorizontal: Spacing.screen,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.sm,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.screen,
    paddingVertical: Spacing.lg,
    backgroundColor: Palette.white,
  },
  // 안 읽은 줄은 아주 옅은 브랜드 배경으로 띄운다.
  // (읽은 줄과 나란히 놓였을 때만 알아볼 정도면 충분하다)
  rowUnread: { backgroundColor: Palette.brandWeak + "66" },

  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: "center",
    justifyContent: "center",
  },

  rowBody: { flex: 1 },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  title: { ...Typo.subtitle, fontSize: 15, flexShrink: 1 },
  dot: {
    width: 6,
    height: 6,
    borderRadius: Radius.full,
    backgroundColor: Palette.brand,
  },
  body: {
    ...Typo.body,
    fontSize: 14,
    marginTop: 3,
    lineHeight: 20,
  },
  time: { ...Typo.caption, fontSize: 12, color: Palette.gray400, marginTop: 4 },

  chevron: { marginLeft: -Spacing.xs },
});
