import type Anthropic from '@anthropic-ai/sdk';

// 공용 Anthropic 모델 상수 — 모든 API 라우트가 이걸 import 해서 사용.
// 모델 retire 시 이 한 줄만 바꾸면 전체 반영됨.
// 이력: 'claude-sonnet-4-20250514' retire(404, PDF 파싱 전부 실패) → 'claude-sonnet-4-6' → 'claude-sonnet-5-5'
export const ANTHROPIC_MODEL = 'claude-sonnet-5-5';

// Sonnet 5.5 는 thinking 이 항상 켜져 있다 (thinking: {type:'disabled'} 는 400).
// 이 도구의 호출은 전부 추출·분류·요약이라 effort 'low' — 단순 요청에서는 thinking 을 대부분 건너뛰어 지연이 짧다.
// thinking 도 max_tokens 에 포함되므로 한도는 응답 길이보다 넉넉히 잡는다.
export const LOW_EFFORT = { effort: 'low' } as const;

/**
 * 응답의 text 블록만 이어 붙여 반환.
 * Sonnet 5.5 응답은 thinking 블록으로 시작할 수 있으므로 content[0] 으로 읽으면 빈 문자열이 된다.
 * 모델이 응답을 거부(refusal)하면 오류를 던진다.
 */
export function responseText(message: Anthropic.Message): string {
  if (message.stop_reason === 'refusal') {
    throw new Error('모델이 이 요청에 대한 응답을 거부했습니다 (refusal)');
  }
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}
