import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      hasApiKey: Boolean(process.env.GEMINI_API_KEY),
      model: 'gemini-3.8-flash-tts',
    });
  });

  // Text-To-Speech endpoint using gemini-3.8-flash-tts
  app.post('/api/tts', async (req, res) => {
    try {
      const {
        text,
        voice = 'Kore',
        style = 'Clear, authoritative emergency broadcast alert announcer',
      } = req.body;

      if (!text || typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'Текст для озвучення обов’язковий' });
      }

      // Valid prebuilt voices: Puck, Charon, Kore, Fenrir, Zephyr
      const validVoices = ['Kore', 'Fenrir', 'Puck', 'Charon', 'Zephyr'];
      const chosenVoice = validVoices.includes(voice) ? voice : 'Kore';

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: text.trim(),
                speechMetadata: {
                  style: style || 'Clear, authoritative civil defense emergency announcer',
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: chosenVoice },
            },
          },
        },
      });

      const candidate = response.candidates?.[0];
      const part = candidate?.content?.parts?.[0];
      const audioBase64 = part?.inlineData?.data;

      if (!audioBase64) {
        return res.status(500).json({
          error: 'Модель не повернула аудіодані. Перевірте квоту або API ключ.',
        });
      }

      return res.json({
        audioBase64,
        mimeType: part?.inlineData?.mimeType || 'audio/wav',
        text: text.trim(),
        voice: chosenVoice,
      });
    } catch (err: any) {
      console.error('Помилка генерації TTS:', err);
      return res.status(500).json({
        error: err?.message || 'Помилка синтезу мовлення через Gemini TTS',
      });
    }
  });

  // AI Emergency Announcement Draft Generator endpoint using gemini-3.8-flash
  app.post('/api/generate-alert', async (req, res) => {
    const {
      alertType = 'clear', // 'clear' (відбій) or 'alert' (тривога)
      region = 'Київ та Київська область',
      threatType = 'ракетної небезпеки та ударних БПЛА',
      additionalNotes = '',
    } = req.body || {};

    try {
      const isClear = alertType === 'clear';
      const prompt = `Ви — офіційний диктор цивільного захисту Державної служби України з надзвичайних ситуацій (ДСНС).
Складіть офіційний, виразний текст голосового радіосповіщення для цивільного населення.
Подія: ${isClear ? 'ВІДБІЙ ПОВІТРЯНОЇ ТРИВОГИ (Скасування тривоги)' : 'ОГОЛОШЕННЯ ПОВІТРЯНОЇ ТРИВОГИ'}.
Регіон: ${region}.
Деталі загрози: ${threatType}.
${additionalNotes ? `Додаткові вказівки: ${additionalNotes}` : ''}

Вимоги:
1. Початок обов'язково зі слів: "${isClear ? 'Увага! Відбій повітряної тривоги' : 'Увага! Повітряна тривога'} в [регіоні]".
2. Чітка інструкція для громадян: ${
        isClear
          ? 'безпечно залишати укриття, оглянути приміщення, не торкатися підозрілих уламків, повернутися до звичних справ'
          : 'негайно пройти в найближче укриття або скористатися правилом двох стін, не ігнорувати сирену'
      }.
3. Мова: бездоганна українська, офіційно-діловий та впевнений тон диктора.
4. Довжина: від 2 до 4 лаконічних речень (ідеально для голосового оповіщення через динаміки).
5. Поверніть виключно сам текст сповіщення без лапок, приміток та форматування.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
      });

      const text = response.text?.trim() || '';
      return res.json({ text });
    } catch (err: any) {
      console.warn('AI alert generation warning, using official fallback template:', err?.message);
      // Resilient fallback template so user always gets an authentic official announcement
      const isClear = alertType === 'clear';
      const fallbackText = isClear
        ? `Увага! Відбій повітряної тривоги ${region ? `в регіоні: ${region}` : 'по всій території України'}. Загроза ворожого повітряного нападу минула. Ви можете безпечно залишати укриття та повернутися до звичних справ. Слідкуйте за офіційними повідомленнями.`
        : `Увага! Повітряна тривога ${region ? `в регіоні: ${region}` : 'по всій території України'}! Зафіксовано загрозу застосування зброї. Усім терміново пройти в найближчі укриття та не ігнорувати сигнали небезпеки!`;
      return res.json({ text: fallbackText });
    }
  });

  // Serve static files in production or Vite middleware in dev
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server started on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
