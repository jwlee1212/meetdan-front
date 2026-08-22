// 파일: constants/avatars.ts
// 프로필 캐릭터 이미지 6종(곰돌이). 마이 탭 편집 시트와 팀원 프로필 카드가 함께 쓴다.
export const profileImages = [
  require("../assets/images/profile_avatars/1.svg"),
  require("../assets/images/profile_avatars/2.svg"),
  require("../assets/images/profile_avatars/3.svg"),
  require("../assets/images/profile_avatars/4.svg"),
  require("../assets/images/profile_avatars/5.svg"),
  require("../assets/images/profile_avatars/6.svg"),
];

/** 저장된 인덱스가 범위를 벗어나도 화면이 깨지지 않게 안전하게 꺼낸다. */
export const getAvatarSource = (idx?: number) =>
  profileImages[idx ?? 0] ?? profileImages[0];
