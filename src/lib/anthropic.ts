// 공용 Anthropic 모델 상수 — 모든 API 라우트가 이걸 import 해서 사용.
// 모델 retire 시 이 한 줄만 바꾸면 전체 반영됨.
// (이전 'claude-sonnet-4-20250514' 가 404 not_found 로 retire되어 PDF 파싱이 전부 실패했던 이력 있음)
export const ANTHROPIC_MODEL = 'claude-sonnet-4-6';

export async function analyzeWithClaude(prompt: string): Promise<string> {
  throw new Error('Anthropic integration not configured');
}
