// 파일: components/ui/member-profile-sheet.tsx
import { Image } from "expo-image";
import { useRef } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Badge } from "@/components/ui/badge";
import { BottomSheet, SheetCancel } from "@/components/ui/bottom-sheet";
import { getAvatarSource } from "@/constants/avatars";
import { Palette, Radius, Spacing, Typo } from "@/constants/theme";
import type { TeamMember } from "@/store/useStore";

/**
 * 팀원 한 명의 프로필 시트.
 *
 * 게시글 상세(post/[id])와 받은 신청 상세(match/party/[id])가 같은 걸 쓴다.
 * 신청을 수락할지 말지는 "어떤 사람들인지"를 보고 정하는 것이라, 두 화면에서
 * 보이는 정보가 달라서는 안 된다.
 *
 * member 가 null 이면 닫힌다. 닫히는 애니메이션이 도는 동안 내용이 비어
 * 보이지 않게 마지막 대상을 붙잡아 둔다.
 */
export function MemberProfileSheet({
  member,
  onClose,
}: {
  member: TeamMember | null;
  onClose: () => void;
}) {
  const last = useRef<TeamMember | null>(null);
  if (member) last.current = member;
  const shown = member ?? last.current;

  return (
    <BottomSheet visible={!!member} onClose={onClose}>
      {shown && (
        <View style={styles.sheet}>
          <Image
            source={getAvatarSource(shown.avatarIdx)}
            style={styles.avatar}
          />
          <Text style={styles.name}>{shown.name}</Text>

          <View style={styles.badgeRow}>
            {shown.role === "LEADER" && <Badge label="팀장" tone="brand" />}
            {!!shown.mbti && <Badge label={shown.mbti} />}
            {!!shown.dept && <Text style={styles.dept}>{shown.dept}</Text>}
          </View>

          <Text style={[styles.bio, !shown.bio && styles.bioEmpty]}>
            {shown.bio || "아직 등록된 소개가 없어요."}
          </Text>

          <SheetCancel onPress={onClose} />
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { alignItems: "center", paddingBottom: Spacing.sm },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: Radius.full,
    backgroundColor: Palette.gray100,
    marginBottom: Spacing.lg,
  },
  name: { ...Typo.title, fontSize: 20 },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: Spacing.sm,
  },
  dept: { ...Typo.caption, fontSize: 14 },
  bio: {
    ...Typo.body,
    textAlign: "center",
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
    lineHeight: 22,
  },
  bioEmpty: { color: Palette.gray500 },
});
