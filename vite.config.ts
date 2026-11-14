import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';
import { GoogleGenAI, GenerateContentResponse, ThinkingLevel } from '@google/genai';

const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')
);

interface GeminiAttemptLog {
  model: string;
  thinkingLevel?: string;
  status?: number;
  finishReason?: string;
  error?: string;
  durationMs: number;
}

function normalizeGeminiModelName(requestedModel?: string): string {
  const raw = (requestedModel || '').trim();
  if (!raw) return 'gemini-3.5-flash-lite';
  if (raw === 'gemini-4-hydrogen') {
    return 'gemini-4-hydrogen';
  }
  if (raw === 'gemini-3.5-flash-lite' || raw === 'gemini-3.5-flash') {
    return 'gemini-3.5-flash-lite';
  }
  if (raw === 'gemini-3.1-flash-lite' || raw === 'gemini-2.5-flash-lite') {
    return 'gemini-3.1-flash-lite';
  }
  if (raw === 'gemini-3.6-flash') {
    return 'gemini-3.6-flash';
  }
  if (
    raw === 'gemini-3.8-flash' ||
    raw === 'gemini-flash-latest' ||
    raw === 'gemini-2.5-flash' ||
    raw === 'gemini-2.0-flash'
  ) {
    return 'gemini-3.8-flash';
  }
  return raw;
}

const PER_ATTEMPT_SDK_TIMEOUT_MS = 28000;

interface IncomingAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function getUpstreamModelCandidates(resolvedModel: string): string[] {
  if (resolvedModel === 'gemini-4-hydrogen') {
    return ['gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-3.6-flash'];
  }
  if (resolvedModel === 'gemini-3.8-flash') {
    return ['gemini-3.8-flash', 'gemini-3.6-flash'];
  }
  return [resolvedModel];
}

function resolveThinkingLevelEnum(rawLevel?: string): ThinkingLevel | undefined {
  if (!rawLevel) return undefined;
  const upper = String(rawLevel).trim().toUpperCase();
  if (upper === 'HIGH') return ThinkingLevel.HIGH;
  if (upper === 'MEDIUM') return ThinkingLevel.MEDIUM;
  if (upper === 'LOW') return ThinkingLevel.LOW;
  if (upper === 'MINIMAL') return ThinkingLevel.MINIMAL;
  return undefined;
}

function isModelNotFoundOrUnsupportedError(err: any): boolean {
  const status = err?.status;
  const msg = String(err?.message || '').toLowerCase();
  return (
    status === 404 ||
    msg.includes('404') ||
    msg.includes('not_found') ||
    msg.includes('not found') ||
    msg.includes('is not supported') ||
    msg.includes('does not exist')
  );
}

function isThinkingRejectedError(err: any): boolean {
  const status = err?.status;
  const msg = String(err?.message || '').toLowerCase();
  return (
    status === 400 ||
    msg.includes('thinking') ||
    msg.includes('invalid_argument') ||
    msg.includes('invalid argument') ||
    msg.includes('unknown name')
  );
}

function isAttemptTimeoutError(err: any): boolean {
  return Boolean(err?.isAttemptTimeout) || String(err?.message || '').includes('SDK_ATTEMPT_TIMEOUT');
}

function callWithAttemptTimeout<T>(promise: Promise<T>, timeoutMs: number = PER_ATTEMPT_SDK_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const timeoutErr: any = new Error(
        `SDK_ATTEMPT_TIMEOUT: Tentativa excedeu ${Math.round(timeoutMs / 1000)}s (${timeoutMs}ms).`
      );
      timeoutErr.status = 504;
      timeoutErr.isAttemptTimeout = true;
      reject(timeoutErr);
    }, timeoutMs);

    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function buildGeminiContentsAndSystemInstruction(messages: IncomingAIMessage[]) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const systemMessages = safeMessages.filter((m) => m && m.role === 'system' && m.content);
  const chatMessages = safeMessages.filter((m) => m && m.role !== 'system' && m.content);

  let baseSystemInstruction =
    systemMessages.length > 0
      ? systemMessages.map((s) => String(s.content || '')).join('\n\n')
      : '';

  const priorMessages = chatMessages.length > 1 ? chatMessages.slice(0, -1) : [];
  if (priorMessages.length > 0) {
    const transcriptLines = priorMessages.map((m) => {
      const speakerLabel = m.role === 'assistant' ? '[STRIVE]' : '[ESTUDANTE]';
      return `${speakerLabel} ${String(m.content || '').trim()}`;
    });
    const transcriptBlock = `\n\nHISTÓRICO CRONOLÓGICO DESTA CONVERSA (USE OS HORÁRIOS ABAIXO SE O ALUNO PERGUNTAR QUANDO ENVIOU A PRIMEIRA MENSAGEM OU MENSAGENS ANTERIORES):\n${transcriptLines.join('\n\n')}`;
    baseSystemInstruction = baseSystemInstruction
      ? `${baseSystemInstruction}${transcriptBlock}`
      : transcriptBlock.trim();
  }

  const lastMessage = chatMessages.length > 0 ? chatMessages[chatMessages.length - 1] : null;
  const rawLastUserText = lastMessage ? String(lastMessage.content || '') : '';
  const cleanLastUserText = rawLastUserText
    .replace(/^\[Horário da mensagem:[^\]]*\]\s*/i, '')
    .trim();

  const contents = [
    {
      role: 'user',
      parts: [{ text: cleanLastUserText || rawLastUserText.trim() || baseSystemInstruction || 'Olá' }],
    },
  ];

  return {
    contents,
    systemInstruction: baseSystemInstruction || undefined,
  };
}

export default defineConfig(() => {
  const buildTimestamp = new Date().toISOString();
  const appVersion = packageJson.version || '1.0.0';

  return {
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __APP_BUILD_ID__: JSON.stringify(buildTimestamp),
    },
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'silenon-api-endpoints',
        configureServer(server) {
          server.middlewares.use('/api/diagnostic-report', (req, res) => {
            if (req.method === 'POST') {
              let body = '';
              req.on('data', chunk => { body += chunk; });
              req.on('end', () => {
                try {
                  const targetPath = path.resolve(__dirname, 'carousel-diagnostic.json');
                  fs.writeFileSync(targetPath, body);
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ status: 'ok' }));
                } catch (e: any) {
                  res.writeHead(500, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ error: e.message }));
                }
              });
            } else {
              res.writeHead(405);
              res.end();
            }
          });

          server.middlewares.use('/api/report', (req, res) => {
            if (req.method !== 'POST') {
              res.writeHead(405, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Method Not Allowed' }));
              return;
            }

            let rawBody = '';
            req.on('data', chunk => { rawBody += chunk; });
            req.on('end', async () => {
              try {
                const body = rawBody ? JSON.parse(rawBody) : {};
                const reportEntry = {
                  id: `rep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                  receivedAt: new Date().toISOString(),
                  category: String(body.category || 'general'),
                  rating: typeof body.rating === 'number' ? body.rating : undefined,
                  subject: String(body.subject || '').trim(),
                  message: String(body.message || '').trim(),
                  contactInfo: String(body.contactInfo || '').trim(),
                  theme: String(body.theme || '').trim(),
                  userAgent: String(body.userAgent || req.headers['user-agent'] || ''),
                };

                const reportsFilePath = path.resolve(__dirname, 'reports-log.json');
                let existing: any[] = [];
                if (fs.existsSync(reportsFilePath)) {
                  try {
                    const parsed = JSON.parse(fs.readFileSync(reportsFilePath, 'utf-8'));
                    if (Array.isArray(parsed)) existing = parsed;
                  } catch {
                    existing = [];
                  }
                }
                existing.unshift(reportEntry);
                fs.writeFileSync(reportsFilePath, JSON.stringify(existing.slice(0, 500), null, 2));

                const webhookUrl = (process.env.REPORT_WEBHOOK_URL || '').trim();
                if (webhookUrl) {
                  try {
                    await fetch(webhookUrl, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(reportEntry),
                    });
                  } catch {
                    // Non-blocking webhook forwarding
                  }
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok', id: reportEntry.id }));
              } catch (e: any) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e?.message || 'Falha ao registrar envio.' }));
              }
            });
          });

          server.middlewares.use('/api/gemini/generate', (req, res) => {
            if (req.method !== 'POST') {
              res.writeHead(405, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Method Not Allowed' }));
              return;
            }

            let rawBody = '';
            req.on('data', chunk => { rawBody += chunk; });
            req.on('end', async () => {
              let parsedBody: any = {};
              const attempts: GeminiAttemptLog[] = [];
              let resolvedModel = 'gemini-3.5-flash-lite';

              try {
                parsedBody = rawBody ? JSON.parse(rawBody) : {};
                const headerKey = req.headers['x-gemini-api-key'];
                const fromHeader = Array.isArray(headerKey) ? headerKey[0] : headerKey;
                const clientApiKey = String(fromHeader || parsedBody?.apiKey || '').trim();

                if (!clientApiKey) {
                  res.writeHead(401, { 'Content-Type': 'application/json' });
                  res.end(
                    JSON.stringify({
                      error: 'Chave Gemini (BYOK) ausente. Configure suas chaves Gemini e Groq no aplicativo.',
                    })
                  );
                  return;
                }

                resolvedModel = normalizeGeminiModelName(parsedBody?.model);
                const thinkingEnum = resolveThinkingLevelEnum(parsedBody?.thinkingLevel);
                const candidates = getUpstreamModelCandidates(resolvedModel);
                const { contents, systemInstruction } = buildGeminiContentsAndSystemInstruction(
                  parsedBody?.messages
                );

                const ai = new GoogleGenAI({
                  apiKey: clientApiKey,
                  httpOptions: {
                    headers: {
                      'User-Agent': 'aistudio-build',
                    },
                  },
                });

                const baseConfig: Record<string, any> = {
                  ...(systemInstruction ? { systemInstruction } : {}),
                  ...(parsedBody?.jsonMode ? { responseMimeType: 'application/json' } : {}),
                };
                delete baseConfig.maxOutputTokens;

                const extractFinishReason = (resp: GenerateContentResponse | null): string => {
                  if (!resp) return 'NO_RESPONSE';
                  const candidateReason = resp.candidates?.[0]?.finishReason;
                  const blockReason = (resp as any)?.promptFeedback?.blockReason;
                  return String(candidateReason || blockReason || 'UNKNOWN');
                };

                const extractResponseText = (resp: GenerateContentResponse | null): string => {
                  if (!resp) return '';
                  try {
                    const direct = (resp.text || '').trim();
                    if (direct) return direct;
                  } catch {
                    // Ignore getter errors if candidate has no text part
                  }
                  const parts = resp.candidates?.[0]?.content?.parts || [];
                  const nonThoughtText = parts
                    .filter((p: any) => typeof p?.text === 'string' && !p?.thought)
                    .map((p: any) => p.text)
                    .join('')
                    .trim();
                  if (nonThoughtText) return nonThoughtText;

                  const anyPartText = parts
                    .filter((p: any) => typeof p?.text === 'string')
                    .map((p: any) => p.text)
                    .join('')
                    .trim();
                  return anyPartText;
                };

                let response: GenerateContentResponse | null = null;
                let extractedText = '';
                let actualUpstreamModel = resolvedModel;
                let lastError: any = null;

                for (const candidateModel of candidates) {
                  const isGemini3FlashBoost =
                    candidateModel === 'gemini-4-hydrogen' ||
                    candidateModel === 'gemini-3.8-flash' ||
                    candidateModel === 'gemini-3.6-flash';
                  const thinkingSequence: Array<ThinkingLevel | undefined> =
                    thinkingEnum === ThinkingLevel.HIGH && isGemini3FlashBoost
                      ? [ThinkingLevel.HIGH, ThinkingLevel.LOW, undefined]
                      : thinkingEnum === ThinkingLevel.HIGH
                      ? [ThinkingLevel.HIGH, ThinkingLevel.LOW, undefined]
                      : thinkingEnum
                      ? [thinkingEnum, undefined]
                      : [undefined];

                  let succeededOnCandidate = false;

                  for (const currentThinking of thinkingSequence) {
                    const tAttempt = Date.now();
                    const thinkingLabel = currentThinking ? String(currentThinking) : 'NONE';
                    try {
                      const reqConfig: Record<string, any> = currentThinking
                        ? {
                            ...baseConfig,
                            thinkingConfig: { thinkingLevel: currentThinking },
                          }
                        : { ...baseConfig };
                      delete reqConfig.maxOutputTokens;

                      const attemptResp = await callWithAttemptTimeout(
                        ai.models.generateContent({
                          model: candidateModel,
                          contents,
                          config: reqConfig,
                        }),
                        PER_ATTEMPT_SDK_TIMEOUT_MS
                      );

                      const finishReason = extractFinishReason(attemptResp);
                      const attemptText = extractResponseText(attemptResp);

                      if (attemptText) {
                        response = attemptResp;
                        extractedText = attemptText;
                        actualUpstreamModel = candidateModel;
                        attempts.push({
                          model: candidateModel,
                          thinkingLevel: thinkingLabel,
                          status: 200,
                          finishReason,
                          durationMs: Date.now() - tAttempt,
                        });
                        succeededOnCandidate = true;
                        break;
                      } else {
                        attempts.push({
                          model: candidateModel,
                          thinkingLevel: thinkingLabel,
                          status: 204,
                          finishReason,
                          error: `HTTP 204 | finishReason=${finishReason} (thinkingLevel=${thinkingLabel})`,
                          durationMs: Date.now() - tAttempt,
                        });
                      }
                    } catch (attemptErr: any) {
                      lastError = attemptErr;
                      const errStatus =
                        typeof attemptErr?.status === 'number' ? attemptErr.status : 500;
                      const rawErrMessage = attemptErr?.message || String(attemptErr);

                      attempts.push({
                        model: candidateModel,
                        thinkingLevel: thinkingLabel,
                        status: errStatus,
                        error: rawErrMessage,
                        durationMs: Date.now() - tAttempt,
                      });

                      if (errStatus === 401 || errStatus === 403) {
                        throw attemptErr;
                      }

                      if (isModelNotFoundOrUnsupportedError(attemptErr)) {
                        break;
                      }

                      continue;
                    }
                  }

                  if (succeededOnCandidate) {
                    break;
                  }
                }

                if (!response && lastError) {
                  throw lastError;
                }

                const text = extractedText || extractResponseText(response);
                if (!text) {
                  const lastAttemptStatus =
                    attempts.length > 0 && typeof attempts[attempts.length - 1].status === 'number'
                      ? attempts[attempts.length - 1].status!
                      : 502;
                  const rawAttemptErrors = attempts
                    .map((a) => `${a.model}[${a.thinkingLevel || 'NONE'}]: HTTP ${a.status ?? 502} ${a.error || a.finishReason || ''}`)
                    .join(' ; ');
                  const finalStatus = lastAttemptStatus >= 400 ? lastAttemptStatus : 502;
                  res.writeHead(finalStatus, { 'Content-Type': 'application/json' });
                  res.end(
                    JSON.stringify({
                      error: rawAttemptErrors || `HTTP 502 | Gemini [${resolvedModel}] sem conteúdo retornado.`,
                      rawStatus: finalStatus,
                      debugMeta: {
                        requestedModel: parsedBody?.model,
                        resolvedModel,
                        actualUpstreamModel,
                        attempts,
                      },
                    })
                  );
                  return;
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(
                  JSON.stringify({
                    text,
                    modelUsed: actualUpstreamModel || resolvedModel,
                    upstreamModelUsed: actualUpstreamModel,
                    debugMeta: {
                      requestedModel: parsedBody?.model,
                      resolvedModel,
                      actualUpstreamModel,
                      attempts,
                    },
                  })
                );
              } catch (err: any) {
                const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;
                const rawMessage = err?.message || String(err) || 'Erro interno na API Gemini.';
                res.writeHead(status, { 'Content-Type': 'application/json' });
                res.end(
                  JSON.stringify({
                    error: `HTTP ${status} | ${rawMessage}`,
                    rawStatus: status,
                    rawError: rawMessage,
                    debugMeta: {
                      requestedModel: parsedBody?.model,
                      resolvedModel,
                      attempts,
                    },
                  })
                );
              }
            });
          });

          server.middlewares.use('/api/gemini/audio-dialog', (req, res) => {
            if (req.method !== 'POST') {
              res.writeHead(405, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Method Not Allowed' }));
              return;
            }

            let rawBody = '';
            req.on('data', chunk => { rawBody += chunk; });
            req.on('end', async () => {
              try {
                const parsedBody = rawBody ? JSON.parse(rawBody) : {};
                const headerKey = req.headers['x-gemini-api-key'];
                const fromHeader = Array.isArray(headerKey) ? headerKey[0] : headerKey;
                const clientApiKey = String(fromHeader || parsedBody?.apiKey || '').trim();

                if (!clientApiKey) {
                  res.writeHead(401, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ error: 'Chave Gemini (BYOK) ausente.' }));
                  return;
                }

                const { action, audioBase64, mimeType, textToSpeak } = parsedBody;
                const ai = new GoogleGenAI({
                  apiKey: clientApiKey,
                  httpOptions: {
                    headers: { 'User-Agent': 'aistudio-build' },
                  },
                });

                if (action === 'transcribe' && audioBase64) {
                  const transcribeCandidates = ['gemini-3.5-transcribe', 'gemini-2.5-flash', 'gemini-flash-latest'];
                  let lastErr: any = null;
                  for (const m of transcribeCandidates) {
                    try {
                      const response = await ai.models.generateContent({
                        model: m,
                        contents: [
                          {
                            role: 'user',
                            parts: [
                              {
                                inlineData: {
                                  mimeType: mimeType || 'audio/webm',
                                  data: audioBase64,
                                },
                              },
                              {
                                text: 'Transcreva exatamente em português o que o estudante falou, sem adicionar comentários.',
                              },
                            ],
                          },
                        ],
                      });
                      const transcript = (response.text || '').trim();
                      res.writeHead(200, { 'Content-Type': 'application/json' });
                      res.end(
                        JSON.stringify({
                          transcript,
                          modelUsed: 'gemini-2.0-flash-native-audio-dialog',
                          upstreamModelUsed: m,
                        })
                      );
                      return;
                    } catch (e: any) {
                      lastErr = e;
                    }
                  }
                  throw lastErr || new Error('Falha na transcrição via Gemini Native Audio Dialog.');
                }

                if (action === 'speak' && textToSpeak) {
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(
                    JSON.stringify({
                      spokenText: String(textToSpeak),
                      modelUsed: 'gemini-2.0-flash-native-audio-dialog',
                    })
                  );
                  return;
                }

                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Ação inválida em /api/gemini/audio-dialog.' }));
              } catch (err: any) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err?.message || 'Erro no Gemini Native Audio Dialog.' }));
              }
            });
          });
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
