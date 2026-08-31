// 파일: app/settings/blocked.tsx
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { EmptyState } from "@/components/ui/empty-state";
import { Divider, NavHeader, Screen } from "@/components/ui/screen";
import { Palette, Radius, Spacing, Typo } from "@/constants/theme";
import { BlockedUser, useStore } from "@/store/useStore";

export default function BlockedListScreen() {
  const router = useRouter();
  const { blockedUsers, unblockUser } = useStore();

  const confirmUnblock = (user: BlockedUser) =>
    Alert.alert(
      `${user.name} 님의 차단을 해제할까요?`,
      "해제하면 다시 메시지를 주고받을 수 있고, 매칭에서도 만날 수 있어요.",
      [
        { text: "취소", style: "cancel" },
        { text: "차단 해제", onPress: () => unblockUser(user.id) },
      ],
    );

  const renderItem = ({ item }: { item: BlockedUser }) => (
    <View style={styles.row}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{item.name.charAt(0)}</Text>
      </View>

      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {[item.dept, `${item.blockedAt} 차단`].filter(Boolean).join(" · ")}
        </Text>
      </View>

      <Pressable
        onPress={() => confirmUnblock(item)}
        style={({ pressed }) => [styles.unblock, pressed && { opacity: 0.6 }]}
      >
        <Text style={styles.unblockText}>차단 해제</Text>
      </Pressable>
    </View>
  );

  return (
    <Screen tone="grouped">
      <NavHeader title="차단 목록" onBack={() => router.back()} />

      <FlatList
        data={blockedUsers}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <Divider inset={68} />}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          blockedUsers.length > 0 ? (
            <View style={styles.notice}>
              <Ionicons
                name="information-circle-outline"
                size={16}
                color={Palette.gray500}
              />
              <Text style={styles.noticeText}>
                차단한 사용자의 메시지는 보이지 않고, 매칭 상대로도 다시
                만나지 않아요.
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            icon="shield-checkmark-outline"
            title="차단한 사용자가 없어요"
            description={
              "채팅방에서 상대를 길게 누르거나\n채팅방 정보에서 차단할 수 있어요."
            }
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: Spacing.xxxl },

  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.screen,
    paddingVertical: Spacing.lg,
    marginBottom: Spacing.gap,
    backgroundColor: Palette.brandWeak,
  },
  noticeText: {
    ...Typo.caption,
    flex: 1,
    lineHeight: 19,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.screen,
    paddingVertical: Spacing.md,
    backgroundColor: Palette.white,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    backgroundColor: Palette.gray200,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.gray600,
  },
  body: { flex: 1 },
  name: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.gray900,
  },
  meta: { ...Typo.caption, fontSize: 12, marginTop: 2 },

  unblock: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 8,
    borderRadius: Radius.sm,
    backgroundColor: Palette.gray100,
  },
  unblockText: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.gray700,
  },
});
