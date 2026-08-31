// 파일: app/post/[id].tsx
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { API } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { BottomSheet, SheetCancel } from "@/components/ui/bottom-sheet";
import { MemberProfileSheet } from "@/components/ui/member-profile-sheet";
import { PressScale } from "@/components/ui/press-scale";
import { NavHeader, Screen, SectionGap } from "@/components/ui/screen";
import { getAvatarSource } from "@/constants/avatars";
import {
  CampusColor,
  GenderColor,
  Palette,
  Radius,
  Shadow,
  Spacing,
  Typo,
} from "@/constants/theme";
import { Team, TeamMember, useStore } from "@/store/useStore";

export default function PostDetail() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const posts = useStore((state) => state.posts);
  const myTeams = useStore((state) => state.myTeams);
  const setMyTeams = useStore((state) => state.setMyTeams);

  const targetPost = posts.find((p) => p.id.toString() === id);
  const [modalVisible, setModalVisible] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(
    null,
  );
  /** 내 팀 목록을 아직 읽는 중 / 읽지 못했음 */
  const [isLoadingTeams, setIsLoadingTeams] = useState(true);
  const [teamsFailed, setTeamsFailed] = useState(false);

  /**
   * 내 팀 목록은 [내 팀] 탭이 화면에 들어올 때 채운다. 그런데 여기는 홈에서
   * 바로 들어올 수 있어서, 앱을 켜자마자 신청을 누르면 팀이 있는데도
   * myTeams 가 비어 있다 — "팀이 없어요" 가 그래서 떴다.
   * 신청은 이 화면의 본론이니 목록을 직접 읽는다. 겸사겸사 인원 수·상태도
   * 최신값이 되어, 아래 검사들이 오래된 값으로 판단하지 않는다.
   */
  useEffect(() => {
    let alive = true;
    (async () => {
      const result = await API.getMyTeams();
      if (!alive) return;
      if (result.code === 200 && result.data) {
        setMyTeams(result.data);
      } else if (result.code !== 401) {
        // 401(세션 만료)은 _layout.tsx 가 로그인 화면으로 보낸다.
        // 그 밖의 실패는 '팀이 없다'와 구분해야 한다 — 있는 팀을 없다고
        // 말하면 사용자는 팀을 하나 더 만들러 간다.
        setTeamsFailed(true);
      }
      setIsLoadingTeams(false);
    })();
    return () => {
      alive = false;
    };
  }, [setMyTeams]);

  if (!targetPost) {
    return (
      <Screen tone="grouped">
        <NavHeader title="게시글" onBack={() => router.back()} bordered />
        <View style={styles.center}>
          <Text style={styles.emptyText}>삭제된 게시글이에요.</Text>
        </View>
      </Screen>
    );
  }

  const handlePressRequest = () => {
    if (isLoadingTeams) return;

    if (teamsFailed) {
      Alert.alert(
        "잠시 후 다시 시도해주세요",
        "내 팀 목록을 불러오지 못했어요.",
      );
      return;
    }

    if (myTeams.length === 0) {
      Alert.alert("팀이 없어요!", "먼저 [내 팀] 탭에서 팀을 만들어주세요.");
      return;
    }
    setModalVisible(true);
  };

  /**
   * 신청은 서버에 한 줄(matches)을 넣는 것이다.
   *
   * 아래 세 가지 검사는 서버도 똑같이 한다(마이그레이션 009 의
   * assert_match_request_valid). 여기서 먼저 보는 건 왕복 없이 바로
   * 이유를 알려주기 위해서고, 최종 판단은 서버가 한다.
   */
  const confirmRequest = async (myTeam: Team) => {
    if (isSending) return;

    if (myTeam.count !== targetPost.count) {
      Alert.alert(
        "인원수 불일치",
        `상대방은 ${targetPost.count}명을 원해요! (우리팀: ${myTeam.count}명)`,
      );
      return;
    }

    // 과팅이니 이성 팀에게만 신청할 수 있다
    if (myTeam.gender === targetPost.gender) {
      Alert.alert(
        "신청할 수 없어요",
        "이성 팀에게만 신청할 수 있어요. 다른 팀을 찾아보세요.",
      );
      return;
    }

    // 인원이 다 모여야 신청할 수 있다 (상대는 '다 모인 팀'으로 알고 수락한다)
    if (myTeam.currentCount < myTeam.count) {
      Alert.alert(
        "아직 팀원이 부족해요",
        `${myTeam.count - myTeam.currentCount}명이 더 모여야 신청할 수 있어요.`,
      );
      return;
    }

    setIsSending(true);
    try {
      const result = await API.sendMatchRequest(myTeam.id, targetPost.id);
      if (result.code !== 200) {
        // 중복 신청·매칭 완료·정책 위반 — 막힌 이유를 그대로 보여준다
        Alert.alert("신청할 수 없어요", result.message ?? "다시 시도해주세요.");
        return;
      }

      setModalVisible(false);
      Alert.alert("신청 완료! 💌", "상대방이 수락하면 채팅방이 열립니다.", [
        { text: "확인", onPress: () => router.back() },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const genderColor = GenderColor[targetPost.gender];
  const campusColor = CampusColor[targetPost.campus];

  return (
    <Screen tone="grouped">
      <NavHeader title="게시글" onBack={() => router.back()} bordered />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 헤더 ─────────────────────────────────────── */}
        <View style={styles.heroCard}>
          <View style={styles.badgeRow}>
            <Badge label={`${targetPost.campus} 캠퍼스`} colors={campusColor} />
            <Badge label={targetPost.dept} />
          </View>
          <Text style={styles.title}>{targetPost.title}</Text>
          <View style={styles.tags}>
            {targetPost.tags.map((tag: string, i: number) => (
              <Text key={i} style={styles.tagText}>
                {tag}
              </Text>
            ))}
          </View>

          {/* ── 요약 정보 ───────────────────────────────── */}
          <View style={styles.statRow}>
          <StatCard
            icon="people"
            label="인원"
            value={`${targetPost.currentCount}/${targetPost.count}명`}
          />
          <StatCard
            icon="calendar"
            label="평균 나이"
            value={targetPost.age != null ? `${targetPost.age}세` : "—"}
          />
          <StatCard
            icon={genderColor.icon}
            label="성별"
            value={targetPost.gender === "F" ? "여자" : "남자"}
            tint={genderColor}
          />
          </View>
        </View>

        <SectionGap />

        {/* ── 소개글 ───────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>소개</Text>
          <Text style={styles.content}>{targetPost.content}</Text>
        </View>

        <SectionGap />

        {/* ── 팀원 ─────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            팀원 {targetPost.members.length}/{targetPost.count}
          </Text>
          <Text style={styles.sectionDesc}>
            눌러서 프로필을 확인할 수 있어요
          </Text>

          <View style={styles.memberList}>
            {targetPost.members.map((member, i) => (
              <PressScale
                key={`${member.name}-${i}`}
                scaleTo={0.98}
                style={styles.memberRow}
                onPress={() => setSelectedMember(member)}
              >
                <Image
                  source={getAvatarSource(member.avatarIdx)}
                  style={styles.memberAvatar}
                />
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>{member.name}</Text>
                  <Text style={styles.memberMeta} numberOfLines={1}>
                    {[member.dept, member.mbti].filter(Boolean).join(" · ") ||
                      "프로필 보기"}
                  </Text>
                </View>
                {member.role === "LEADER" && (
                  <Badge label="팀장" tone="brand" />
                )}
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={Palette.gray300}
                />
              </PressScale>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* ── 하단 신청 버튼 ───────────────────────────────── */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.lg }]}>
        <PressScale
          style={[styles.requestButton, isLoadingTeams && styles.requestButtonBusy]}
          disabled={isLoadingTeams}
          onPress={handlePressRequest}
        >
          {isLoadingTeams ? (
            <ActivityIndicator color={Palette.white} />
          ) : (
            <Text style={styles.reqBtnText}>이 팀에게 과팅 신청하기 👋</Text>
          )}
        </PressScale>
      </View>

      {/* ── 신청할 내 팀 고르기 ───────────────────────────── */}
      <BottomSheet
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        title="어떤 팀으로 신청할까요?"
        description={`우리 팀 목록 (${myTeams.length}개)`}
      >
        <ScrollView style={styles.teamSelectList}>
          {myTeams.map((team) => (
            <PressScale
              key={team.id}
              scaleTo={0.98}
              style={styles.teamSelectCard}
              disabled={isSending}
              onPress={() => confirmRequest(team)}
            >
              <View style={styles.flexShrink}>
                <Text style={styles.teamSelectTitle}>{team.title}</Text>
                <Text style={styles.teamSelectInfo}>
                  {team.currentCount}/{team.count}명 ·{" "}
                  {team.status === "MATCHED"
                    ? "매칭 완료"
                    : team.status === "ACTIVE"
                      ? "공개중"
                      : "비공개"}
                </Text>
              </View>
              {isSending ? (
                <ActivityIndicator color={Palette.gray400} />
              ) : (
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={Palette.gray400}
                />
              )}
            </PressScale>
          ))}
        </ScrollView>
        <SheetCancel onPress={() => setModalVisible(false)} />
      </BottomSheet>

      {/* ── 팀원 프로필 ───────────────────────────────────── */}
      <MemberProfileSheet
        member={selectedMember}
        onClose={() => setSelectedMember(null)}
      />
    </Screen>
  );
}

/** 인원/나이/성별처럼 짧은 통계 하나를 보여주는 카드. */
function StatCard({
  icon,
  label,
  value,
  tint,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
  tint?: { fg: string; bg: string };
}) {
  const bg = tint?.bg ?? Palette.gray100;
  const fg = tint?.fg ?? Palette.gray700;
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIconWrap, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={16} color={fg} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { ...Typo.body, color: Palette.gray500 },

  scrollContent: { paddingBottom: 120 },

  // 제목·태그·요약을 한 블록에 담는다. 좌우로 꽉 차고 모서리를 굴리지 않는다.
  heroCard: {
    backgroundColor: Palette.white,
    padding: Spacing.screen,
  },
  badgeRow: { flexDirection: "row", gap: Spacing.xs, marginBottom: Spacing.md },
  title: { ...Typo.display, fontSize: 22, marginBottom: Spacing.md },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  tagText: {
    backgroundColor: Palette.gray100,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    color: Palette.gray600,
    fontSize: 12,
    fontWeight: "600",
  },

  statRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  statCard: {
    flex: 1,
    alignItems: "center",
    gap: 6,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Palette.gray100,
  },
  statIconWrap: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  statValue: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.gray900,
  },
  statLabel: { ...Typo.caption, fontSize: 12 },

  section: {
    backgroundColor: Palette.white,
    padding: Spacing.screen,
  },
  sectionTitle: Typo.section,
  sectionDesc: { ...Typo.caption, marginTop: 4 },
  content: { ...Typo.body, lineHeight: 24 },

  memberList: { gap: Spacing.sm, marginTop: Spacing.md },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Palette.gray100,
  },
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    backgroundColor: Palette.gray200,
  },
  memberInfo: { flex: 1 },
  memberName: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.gray900,
  },
  memberMeta: { ...Typo.caption, marginTop: 2 },

  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.screen,
    paddingTop: Spacing.md,
    backgroundColor: Palette.white,
    borderTopWidth: 1,
    borderTopColor: Palette.gray200,
    ...Shadow.soft,
  },
  requestButton: {
    backgroundColor: Palette.brand,
    paddingVertical: 18,
    borderRadius: Radius.lg,
    alignItems: "center",
    // 스피너와 글자의 높이가 달라 버튼이 들썩이지 않게 고정한다
    justifyContent: "center",
    minHeight: 56,
  },
  requestButtonBusy: { opacity: 0.7 },
  reqBtnText: { color: Palette.white, fontSize: 17, fontWeight: "700" },

  flexShrink: { flex: 1 },
  teamSelectList: { maxHeight: 300 },
  teamSelectCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Palette.gray200,
    borderRadius: Radius.lg,
    marginBottom: Spacing.sm,
  },
  teamSelectTitle: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.gray900,
    marginBottom: 2,
  },
  teamSelectInfo: { ...Typo.caption },
});
