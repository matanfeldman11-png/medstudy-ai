import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, Calendar, Clock, BookOpen, Moon, Sun, 
  FileText, CheckCircle2, Trash2, Sparkles, ArrowLeft,
  ArrowRight, Send, MessageSquare, HelpCircle, Download, AlertCircle,
  Layers, Award, Activity, RotateCcw, Flame, HeartPulse, Settings, Key, Loader2,
  Plus, FolderOpen, ArrowUp, ArrowDown, Brain, Check, Lock, FilePlus2, ShieldCheck, User, History, Target,
  Printer, AlertTriangle, RefreshCw, X, Search, Volume2, Square, BarChart3
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';
import JSZip from 'jszip';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

const DAYS_OF_WEEK = [
  { id: 0, label: 'א׳', full: 'ראשון' },
  { id: 1, label: 'ב׳', full: 'שני' },
  { id: 2, label: 'ג׳', full: 'שלישי' },
  { id: 3, label: 'ד׳', full: 'רביעי' },
  { id: 4, label: 'ה׳', full: 'חמישי' },
  { id: 5, label: 'ו׳', full: 'שישי' },
  { id: 6, label: 'ש׳', full: 'שבת' },
];

// ==========================================
// 1. מנוע אחסון IndexedDB
// ==========================================
const DB_NAME = 'MedStudyNursingDB';
const DB_VERSION = 1;
const STORE_NAME = 'courses_store';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveCoursesToIDB(courses: any[]) {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(courses, 'all_courses');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadCoursesFromIDB(): Promise<any[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get('all_courses');
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// ==========================================
// 2. פענוח JSON חסין שגיאות וערבוב תשובות
// ==========================================
function safeParseAIJson(rawText: string) {
  let cleaned = rawText
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  const start = firstBrace === -1 ? firstBracket : firstBracket === -1 ? firstBrace : Math.min(firstBrace, firstBracket);
  const lastBrace = cleaned.lastIndexOf('}');
  const lastBracket = cleaned.lastIndexOf(']');
  const end = Math.max(lastBrace, lastBracket);

  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }

  cleaned = cleaned
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/[\u0000-\u0019]+/g, ' ');

  return JSON.parse(cleaned);
}

function shuffleQuestionOptions<T extends { options?: string[]; opts?: string[]; correctIndex?: number; ans?: number; correct?: number }>(item: T): T {
  const listKey = item.options ? 'options' : 'opts';
  const indexKey = item.correctIndex !== undefined ? 'correctIndex' : item.ans !== undefined ? 'ans' : 'correct';
  const originalList = [...(item[listKey] || [])];
  const originalCorrectIdx = item[indexKey] as number;

  if (originalList.length <= 1 || originalCorrectIdx === undefined) return item;

  const indexed = originalList.map((text, idx) => ({ text, isCorrect: idx === originalCorrectIdx }));
  for (let i = indexed.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indexed[i], indexed[j]] = [indexed[j], indexed[i]];
  }

  return {
    ...item,
    [listKey]: indexed.map((x) => x.text),
    [indexKey]: indexed.findIndex((x) => x.isCorrect),
  };
}

// ==========================================
// 3. חילוץ טקסט וחלוקה לפי נושאים אמיתיים
// ==========================================
async function extractTextFromFile(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  const arrayBuffer = await file.arrayBuffer();

  if (ext === 'txt') {
    return await file.text();
  }

  if (ext === 'pdf') {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      fullText += `\n[עמוד ${i}]\n` + content.items.map((item: any) => item.str).join(' ') + '\n';
    }
    return fullText;
  }

  if (ext === 'docx' || ext === 'doc') {
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  }

  if (ext === 'pptx' || ext === 'ppt') {
    const zip = await JSZip.loadAsync(arrayBuffer);
    let slideText = '';
    const slideFiles = Object.keys(zip.files)
      .filter((name) => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'))
      .sort((a, b) => {
        const numA = parseInt(a.replace(/\D/g, ''), 10);
        const numB = parseInt(b.replace(/\D/g, ''), 10);
        return numA - numB;
      });

    for (let idx = 0; idx < slideFiles.length; idx++) {
      const xml = await zip.files[slideFiles[idx]].async('text');
      const matches = xml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g) || [];
      slideText += `\n[שקופית ${idx + 1}]\n` + matches.map((tag) => tag.replace(/<[^>]+>/g, '')).join(' ') + '\n';
    }
    return slideText;
  }

  return '';
}

interface TopicUnit {
  id: number;
  fileName: string;
  detectedHeading: string;
  text: string;
  charCount: number;
}

function extractNaturalTopicUnits(files: any[]): TopicUnit[] {
  const units: TopicUnit[] = [];
  let unitCounter = 0;

  files.forEach((f) => {
    const rawSegments = f.text
      .split(/(?=\[שקופית \d+\])|(?=\[עמוד \d+\])|\n{2,}/)
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 25);

    if (rawSegments.length === 0) {
      units.push({
        id: unitCounter++,
        fileName: f.name,
        detectedHeading: f.name.replace(/\.[^/.]+$/, ''),
        text: f.text || 'אין טקסט בקובץ',
        charCount: (f.text || '').length,
      });
      return;
    }

    let buffer: string[] = [];
    let bufferLen = 0;

    rawSegments.forEach((seg: string, idx: number) => {
      const cleanFirstLine = seg
        .replace(/^\[(שקופית|עמוד) \d+\]\s*/g, '')
        .split('\n')[0]
        .slice(0, 75)
        .trim();

      const looksLikeNewTopic =
        bufferLen > 1800 &&
        (cleanFirstLine.length > 4 && cleanFirstLine.length < 65 && !cleanFirstLine.endsWith('.'));

      if (looksLikeNewTopic || bufferLen > 3800) {
        const combined = buffer.join('\n\n');
        const heading =
          combined
            .replace(/^\[(שקופית|עמוד) \d+\]\s*/g, '')
            .split('\n')[0]
            .slice(0, 70)
            .trim() || `${f.name} - חלק ${units.length + 1}`;

        units.push({
          id: unitCounter++,
          fileName: f.name,
          detectedHeading: heading,
          text: combined,
          charCount: combined.length,
        });
        buffer = [seg];
        bufferLen = seg.length;
      } else {
        buffer.push(seg);
        bufferLen += seg.length;
      }

      if (idx === rawSegments.length - 1 && buffer.length > 0) {
        const combined = buffer.join('\n\n');
        const heading =
          combined
            .replace(/^\[(שקופית|עמוד) \d+\]\s*/g, '')
            .split('\n')[0]
            .slice(0, 70)
            .trim() || `${f.name} - חלק ${units.length + 1}`;

        units.push({
          id: unitCounter++,
          fileName: f.name,
          detectedHeading: heading,
          text: combined,
          charCount: combined.length,
        });
      }
    });
  });

  return units;
}

function fallbackBalancedMerge(units: TopicUnit[], targetSessionCount: number) {
  if (units.length <= targetSessionCount) {
    const res = units.map((u, idx) => ({
      sessionIndex: idx,
      title: u.detectedHeading,
      fileName: u.fileName,
      rationale: 'יחידת לימוד ממוקדת מתוך הקובץ',
      textChunk: u.text,
      charCount: u.charCount,
    }));
    while (res.length < targetSessionCount) {
      const last = res[res.length - 1];
      res.push({
        ...last,
        sessionIndex: res.length,
        title: `${last.title} — חזרה והעמקה קלינית`,
        rationale: 'סשן ייעודי לחזרה ואינטגרציה של החומר',
      });
    }
    return res;
  }

  const totalChars = units.reduce((acc, u) => acc + u.charCount, 0);
  const targetPerSession = Math.ceil(totalChars / targetSessionCount);
  const result: any[] = [];
  let currentUnits: TopicUnit[] = [];
  let currentLen = 0;

  units.forEach((u, idx) => {
    currentUnits.push(u);
    currentLen += u.charCount;
    const remainingSessions = targetSessionCount - result.length - 1;
    const remainingUnits = units.length - idx - 1;

    if (remainingSessions > 0 && currentLen >= targetPerSession && remainingUnits >= remainingSessions) {
      result.push({
        sessionIndex: result.length,
        title: currentUnits[0].detectedHeading,
        fileName: [...new Set(currentUnits.map((x) => x.fileName))].join(' + '),
        rationale: `כולל ${currentUnits.length} יחידות נושאיות ברצף`,
        textChunk: currentUnits.map((x) => x.text).join('\n\n'),
        charCount: currentLen,
      });
      currentUnits = [];
      currentLen = 0;
    }
  });

  if (currentUnits.length > 0) {
    result.push({
      sessionIndex: result.length,
      title: currentUnits[0].detectedHeading,
      fileName: [...new Set(currentUnits.map((x) => x.fileName))].join(' + '),
      rationale: `כולל ${currentUnits.length} יחידות נושאיות ברצף`,
      textChunk: currentUnits.map((x) => x.text).join('\n\n'),
      charCount: currentLen,
    });
  }

  return result;
}

function getDurationConfig(minutes: number) {
  if (minutes <= 30) {
    return {
      blocksCount: 3,
      sentencesPerBlock: '4-5',
      quizCount: 5,
      cardsCount: 6,
      triageMode: 'מצב ממוקד מבחן (High-Yield בלבד): סנן פרטים שוליים והתמקד רק במנגנונים קריטיים, דגלים אדומים והתערבויות סיעודיות חיוניות.',
    };
  }
  if (minutes <= 45) {
    return {
      blocksCount: 4,
      sentencesPerBlock: '5-7',
      quizCount: 7,
      cardsCount: 8,
      triageMode: 'איזון קליני ממוקד: כסה את המושגים המרכזיים והתערבויות המפתח תוך דילוג על רקע תיאורטי משני.',
    };
  }
  if (minutes <= 60) {
    return {
      blocksCount: 5,
      sentencesPerBlock: '6-8',
      quizCount: 10,
      cardsCount: 10,
      triageMode: 'כיסוי קליני מלא: פתופיזיולוגיה, הערכה סיעודית, תרופות וניהול סיבוכים.',
    };
  }
  return {
    blocksCount: 7,
    sentencesPerBlock: '8-10',
    quizCount: 12,
    cardsCount: 14,
    triageMode: 'העמקה מקסימלית (90 דק׳): ניתוח מקיף של כל מנגנוני הפעולה, אבחנה מבדלת, ערכי מעבדה ופרוטוקולי טיפול מלאים.',
  };
}

// ==========================================
// 4. תקשורת AI, ביקורת מנכ"ל עיוורת וסידור פדגוגי
// ==========================================
async function callGeminiWithFallback(apiKey: string, prompt: string, isJson = true): Promise<any> {
  const useServerProxy = import.meta.env.VITE_USE_PROXY === 'true' && !apiKey;

  if (useServerProxy) {
    const res = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, isJson }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'שגיאת שרת Proxy');
    return isJson ? safeParseAIJson(data.text) : data.text;
  }

  let candidateModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];

  try {
    const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const listData = await listRes.json();
    if (listData?.models) {
      const dynamicModels = listData.models
        .filter(
          (m: any) =>
            m.supportedGenerationMethods?.includes('generateContent') &&
            (m.name.includes('flash') || m.name.includes('pro')) &&
            !m.name.includes('1.5') &&
            !m.name.includes('vision')
        )
        .map((m: any) => m.name.replace('models/', ''));

      if (dynamicModels.length > 0) {
        candidateModels = [...new Set([...dynamicModels, ...candidateModels])];
      }
    }
  } catch (e) {
    console.warn('ממשיך עם רשימת מודלים ברירת מחדל', e);
  }

  let lastError: any = null;

  for (const modelName of candidateModels) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000);

      try {
        const generationConfig: any = {
          maxOutputTokens: 8192,
          temperature: attempt === 1 ? 0.35 : 0.15,
        };
        if (isJson) generationConfig.responseMimeType = 'application/json';

        const safePrompt = isJson
          ? `${prompt}\n\nחשוב מאוד: החזר JSON תקין בלבד. אל תשתמש במירכאות כפולות (") בתוך ערכי הטקסט עצמם (השתמש בגרש בודד ' במקום מירכאות כפולות בתוך משפטים).`
          : prompt;

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              contents: [{ parts: [{ text: safePrompt }] }],
              generationConfig,
            }),
          }
        );

        const data = await response.json();
        if (data.error) throw new Error(data.error.message);

        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawText) {
          if (isJson) {
            return safeParseAIJson(rawText);
          }
          return rawText;
        }
      } catch (err: any) {
        lastError = err;
        const isRateLimit = String(err?.message || '').includes('429') || String(err?.message || '').toLowerCase().includes('quota');
        console.warn(`ניסיון ${attempt} במודל ${modelName} נכשל${isRateLimit ? ' (מגבלת קצב - ממתין 12 שניות)' : ''}, מנסה שוב...`, err);
        if (isRateLimit) {
          await new Promise((res) => setTimeout(res, 12000));
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }
  }

  throw new Error(`לא התקבלה תשובה תקינה מהמודל. שגיאה: ${lastError?.message || 'שגיאה לא ידועה'}`);
}

type ReviewTaskType = 'planning' | 'lesson' | 'flashcards' | 'quiz' | 'marathon' | 'codeblue';

const TASK_LABELS: Record<ReviewTaskType, string> = {
  planning: 'תוכנית הלימודים וחלוקת הסשנים',
  lesson: 'השיעור הקליני המודרך',
  flashcards: 'כרטיסיות השינון הקליניות',
  quiz: 'הבוחן האמריקאי המסכם',
  marathon: 'מרתון תיקון הטעויות האישי',
  codeblue: 'סימולציית החירום Code Blue',
};

// ביקורת עיוורת מנקודת מבט של מנכ"ל קפדן עבור כל חלקי המערכת
async function executiveBlindReviewAndRefine(
// ביקורת מנכ"ל היברידית: ביקורת עיוורת מלאה לתוכנית ולשיעור, וסטנדרט מנכ"ל מהיר לשאר הכלים
async function executiveBlindReviewAndRefine(
  apiKey: string,
  initialPrompt: string,
  sourceContext: string,
  taskType: ReviewTaskType
): Promise<any> {
  // עבור כרטיסיות, בחנים וסימולציות: קריאה אחת חדה עם סטנדרט מנכ"ל מובנה (חוסך פי 3 זמן ומכסת בקשות)
  if (taskType !== 'planning' && taskType !== 'lesson') {
    const fastExecutivePrompt = `${initialPrompt}

סטנדרט איכות מחייב (בקרת מנכ"ל קליני):
- דיוק קליני מקסימלי ברמת מבחן רישוי ממשלתי בסיעוד (עדיפויות ABC, דגלים אדומים, תרופות וערכי נורמה).
- מסיחים חכמים והגיוניים קלינית (ללא תשובות שקופות מדי) והסברים מלמדים וממוקדים.`;
    return await callGeminiWithFallback(apiKey, fastExecutivePrompt, true);
  }

  // עבור תוכנית הלימודים והשיעור המודרך: ביקורת עיוורת מלאה ומהירה
  const initialDraft = await callGeminiWithFallback(apiKey, initialPrompt, true);

  try {
    const ceoReviewPrompt = `אתה מנכ"ל קפדן של חברת EdTech רפואית. ספק חיצוני הגיש טיוטה עבור ${TASK_LABELS[taskType]}:
${JSON.stringify(initialDraft)}

חומר מקור (תקציר):
${sourceContext.slice(0, 8000)}

כתוב עד 3 הוראות תיקון קצרות וחדות בעברית (מקסימום 80 מילים סה"כ, טקסט רגיל) לשיפור הדיוק הקליני, סדר הלימוד או עומק ההסבר.`;

    const ceoCritique = await callGeminiWithFallback(apiKey, ceoReviewPrompt, false);

    const refinePrompt = `טיוטת JSON קיימת:
${JSON.stringify(initialDraft)}

הוראות המנכ"ל לשיפור:
${ceoCritique}

הטמע את התיקונים והחזר JSON תקין בלבד באותו מבנה בדיוק ללא טקסט מסביב.`;

    return await callGeminiWithFallback(apiKey, refinePrompt, true);
  } catch (err) {
    console.warn(`ביקורת מנכ"ל (${taskType}) דולגה, מחזיר טיוטה ראשונית:`, err);
    return initialDraft;
  }
}

async function organizeUnitsPedagogicallyWithAI(
  apiKey: string,
  units: TopicUnit[],
  targetSessionCount: number,
  sessionDuration: number
) {
  const catalog = units.map((u) => ({
    unitId: u.id,
    fileName: u.fileName,
    heading: u.detectedHeading,
    preview: u.text.slice(0, 350).replace(/\s+/g, ' '),
  }));

  const prompt = `אתה ראש חוג לסיעוד ומתכנן תוכניות לימודים.
לפניך רשימה של ${units.length} יחידות תוכן שחולצו מקבצי הקורס, ויש לך בדיוק ${targetSessionCount} סשנים (ימי למידה) של ${sessionDuration} דקות עד לבחינה.

המשימה שלך:
1. קבץ וסדר את כל יחידות התוכן (unitId) לתוך בדיוק ${targetSessionCount} סשנים בסדר למידה פדגוגי והגיוני בסיעוד:
   - קודם מושגי יסוד, אנטומיה ופיזיולוגיה תקינה
   - אחר כך פתופיזיולוגיה ומנגנוני מחלה
   - לאחר מכן אבחון, פרמקולוגיה, התערבות סיעודית וניהול סיבוכים
2. חובה לכלול את כל ה-unitId (מ-0 עד ${units.length - 1}) ללא דילוגים וללא כפילויות (אם יש יותר סשנים מיחידות, הקצה סשן אחרון לחזרה מסכמת).
3. תן לכל סשן כותרת קלינית ברורה בעברית ונימוק קצר מדוע הוא ממוקם בשלב זה.

החזר JSON תקין בלבד:
{
  "pedagogicalStrategy": "הסבר קצר על ההיגיון הפדגוגי של סדר הלימוד",
  "sessions": [
    {
      "sessionIndex": 0,
      "title": "כותרת קלינית ברורה לסשן",
      "rationale": "נימוק קצר למיקום בסדר הלימוד",
      "unitIds": [0, 1]
    }
  ]
}

רשימת היחידות:
${JSON.stringify(catalog)}`;

  const aiPlan = await executiveBlindReviewAndRefine(apiKey, prompt, JSON.stringify(catalog), 'planning');
  if (!Array.isArray(aiPlan?.sessions) || aiPlan.sessions.length === 0) {
    throw new Error('המודל לא החזיר מבנה סשנים תקין');
  }

  const usedUnitIds = new Set<number>();
  const builtSessions = aiPlan.sessions.slice(0, targetSessionCount).map((s: any, idx: number) => {
    const validIds = (s.unitIds || []).filter((id: number) => typeof id === 'number' && units[id] && !usedUnitIds.has(id));
    validIds.forEach((id: number) => usedUnitIds.add(id));

    const matchedUnits = validIds.map((id: number) => units[id]);
    const combinedText = matchedUnits.map((u: TopicUnit) => u.text).join('\n\n');
    const fileNames = [...new Set(matchedUnits.map((u: TopicUnit) => u.fileName))].join(' + ');

    return {
      sessionIndex: idx,
      title: s.title || matchedUnits[0]?.detectedHeading || `יחידת לימוד ${idx + 1}`,
      fileName: fileNames || units[0]?.fileName || 'חומר לימוד',
      rationale: s.rationale || 'סדר למידה קליני מדורג',
      textChunk: combinedText,
      charCount: combinedText.length,
    };
  });

  const missingUnits = units.filter((u) => !usedUnitIds.has(u.id));
  if (missingUnits.length > 0 && builtSessions.length > 0) {
    const lastTarget = builtSessions[builtSessions.length - 1];
    const extraText = missingUnits.map((u) => u.text).join('\n\n');
    lastTarget.textChunk = [lastTarget.textChunk, extraText].filter(Boolean).join('\n\n');
    lastTarget.charCount = lastTarget.textChunk.length;
  }

  while (builtSessions.length < targetSessionCount) {
    const prev = builtSessions[builtSessions.length - 1];
    builtSessions.push({
      sessionIndex: builtSessions.length,
      title: `אינטגרציה וחזרה מסכמת: ${prev.title}`,
      fileName: prev.fileName,
      rationale: 'סשן חזרה ואינטגרציה קלינית לפני הבחינה',
      textChunk: prev.textChunk,
      charCount: prev.charCount,
    });
  }

  return {
    strategy: aiPlan.pedagogicalStrategy || 'הנושאים סודרו מהיסודות התיאורטיים אל ההתערבות הקלינית.',
    sessions: builtSessions,
  };
}

async function generateInteractiveLessonBlocks(apiKey: string, topic: string, rawTextChunk: string, duration: number) {
  const cfg = getDurationConfig(duration);
  const fullContext = rawTextChunk.slice(0, 35000);

  const prompt = `אתה מרצה ומדריך קליני בסיעוד. בנה שיעור אינטראקטיבי בעברית לנושא '${topic}' עבור סשן של ${duration} דקות.
הנחיית תעדוף זמן: ${cfg.triageMode}

חלק את השיעור ל-${cfg.blocksCount} שלבי לימוד עוקבים (blocks) בסדר דידקטי ברור (מהגדרה ומנגנון אל אבחון והתערבות סיעודית).
בכל שלב:
1. "title": כותרת ממוקדת.
2. "explanation": הסבר בהיר ומעמיק בן ${cfg.sentencesPerBlock} משפטים מתוך החומר בלבד.
3. "checkQuestion": שאלת הבנה יישומית/קלינית לבדיקת שליטה לפני מעבר לשלב הבא.
4. "options": 4 אפשרויות תשובה סבירות.
5. "correctIndex": אינדקס התשובה הנכונה (0-3).
6. "feedbackByOption": מערך של 4 משובים קצרים וספציפיים (אחד לכל אפשרות) המסבירים לסטודנט למה הבחירה נכונה או מה הטעות הקלינית בה.

בנוסף, צור טבלת השוואה קלינית קצרה ("comparisonTable") אם רלוונטי לחומר.

החזר JSON תקין בלבד:
{
  "blocks": [
    {
      "title": "כותרת שלב 1",
      "explanation": "הסבר מפורט...",
      "checkQuestion": "שאלה קלינית?",
      "options": ["אפשרות 1", "אפשרות 2", "אפשרות 3", "אפשרות 4"],
      "correctIndex": 0,
      "feedbackByOption": ["משוב לאפשרות 1", "משוב לאפשרות 2", "משוב לאפשרות 3", "משוב לאפשרות 4"]
    }
  ],
  "comparisonTable": [
    { "param": "פרמטר", "acute": "ממצא א", "chronic": "ממצא ב" }
  ]
}

חומר הלימוד של הסשן:
${fullContext}`;

  const parsed = await executiveBlindReviewAndRefine(apiKey, prompt, fullContext, 'lesson');

  if (Array.isArray(parsed.blocks)) {
    parsed.blocks = parsed.blocks.map((b: any) => {
      const zipped = (b.options || []).map((opt: string, idx: number) => ({
        opt,
        feedback: b.feedbackByOption?.[idx] || (idx === b.correctIndex ? 'תשובה נכונה!' : 'תשובה שגויה, נסה שוב.'),
        isCorrect: idx === b.correctIndex,
      }));
      for (let i = zipped.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [zipped[i], zipped[j]] = [zipped[j], zipped[i]];
      }
      return {
        ...b,
        options: zipped.map((z: any) => z.opt),
        feedbackByOption: zipped.map((z: any) => z.feedback),
        correctIndex: zipped.findIndex((z: any) => z.isCorrect),
      };
    });
  }

  return parsed;
}

async function generateFlashcardsOnly(apiKey: string, rawTextChunk: string, duration: number) {
  const cfg = getDurationConfig(duration);
  const prompt = `צור ${cfg.cardsCount} כרטיסיות שינון קליניות בעברית מתוך החומר הבא. התמקד במושגים החשובים ביותר למבחן.
החזר מערך JSON תקין בלבד:
[
  { "id": 1, "front": "מושג / שאלה קצרה", "back": "הסבר קליני ממוקד" }
]
חומר: ${rawTextChunk.slice(0, 30000)}`;

  return await executiveBlindReviewAndRefine(apiKey, prompt, rawTextChunk, 'flashcards');
}

async function generateQuizOnly(apiKey: string, rawTextChunk: string, duration: number) {
  const cfg = getDurationConfig(duration);
  const prompt = `צור בוחן של ${cfg.quizCount} שאלות קליניות רב-בררתיות (4 אפשרויות) בעברית מתוך החומר הבא, ברמת מבחן ממשלתי בסיעוד.
החזר מערך JSON תקין בלבד:
[
  {
    "q": "שאלה קלינית",
    "opts": ["אפשרות א", "אפשרות ב", "אפשרות ג", "אפשרות ד"],
    "ans": 0,
    "explanation": "הסבר קליני מלא מדוע זו התשובה הנכונה ומדוע האחרות שגויות"
  }
]
חומר: ${rawTextChunk.slice(0, 30000)}`;

  const parsed = await executiveBlindReviewAndRefine(apiKey, prompt, rawTextChunk, 'quiz');
  return Array.isArray(parsed) ? parsed.map(shuffleQuestionOptions) : [];
}

async function generateMistakesMarathonQuiz(apiKey: string, mistakesBank: any[]) {
  const summary = mistakesBank.slice(0, 20).map((m) => ({
    topic: m.sessionTopic,
    question: m.question,
    wrongChoice: m.userAnswer,
    correctAnswer: m.correctAnswer,
  }));

  const count = Math.min(Math.max(mistakesBank.length, 4), 10);
  const prompt = `אתה מרצה בכיר לסיעוד. סטודנט/ית צבר/ה את הטעויות הבאות לאורך הקורס:
${JSON.stringify(summary, null, 2)}

בנה מרתון של ${count} שאלות תרגול חדשות וממוקדות בעברית (4 אפשרויות לכל שאלה) שבודקות בדיוק את הנושאים ונקודות התורפה שבהן הסטודנט/ית טעה/תה, ברמת מבחן ממשלתי בסיעוד.
החזר מערך JSON תקין בלבד:
[
  {
    "q": "שאלה קלינית חדשה לבדיקת התיקון",
    "opts": ["אפשרות א", "אפשרות ב", "אפשרות ג", "אפשרות ד"],
    "ans": 0,
    "explanation": "הסבר קליני מלא המבהיר את המלכודת הקודמת"
  }
]`;

  const parsed = await executiveBlindReviewAndRefine(apiKey, prompt, JSON.stringify(summary), 'marathon');
  return Array.isArray(parsed) ? parsed.map(shuffleQuestionOptions) : [];
}

async function generateCodeBlueOnly(apiKey: string, rawTextChunk: string) {
  const prompt = `צור 4 תרחישי חירום / התערבות סיעודית (Code Blue) בעברית מתוך החומר הבא.
החזר מערך JSON תקין בלבד:
[
  {
    "scenario": "תיאור מטופל ומדדים חיוניים",
    "question": "מהי ההתערבות הסיעודית הראשונה בעדיפות עליונה?",
    "options": ["התערבות א", "התערבות ב", "התערבות ג"],
    "correct": 0,
    "rationale": "הסבר קליני קצר"
  }
]
חומר: ${rawTextChunk.slice(0, 25000)}`;

  const parsed = await executiveBlindReviewAndRefine(apiKey, prompt, rawTextChunk, 'codeblue');
  return Array.isArray(parsed) ? parsed.map(shuffleQuestionOptions) : [];
}

async function generateWeaknessAnalysis(
  apiKey: string,
  mistakes: { question: string; userAnswer: string; correctAnswer: string; rationale?: string }[],
  lessonBlocks: any[]
): Promise<string> {
  if (!mistakes.length) return '';

  const sectionsSummary = (lessonBlocks || [])
    .map((b: any, idx: number) => `סעיף ${idx + 1}: ${b.title}`)
    .join('\n');

  if (!apiKey.trim()) {
    return `זוהו ${mistakes.length} טעויות. מומלץ לחזור על סעיפי השיעור המודרך הרלוונטיים:\n${sectionsSummary}`;
  }

  const prompt = `אתה מרצה בכיר לסיעוד. סטודנט/ית סיים/ה תרגול וטעה/תה בשאלות הבאות:
${JSON.stringify(mistakes, null, 2)}

אלו סעיפי השיעור המודרך של הסשן:
${sectionsSummary}

כתוב המלצת חזרה קצרה, ברורה וממוקדת בעברית (3-5 משפטים או נקודות קצרות):
1. ציין במפורש אילו סעיפים מתוך השיעור המודרך (לפי מספר סעיף וכותרת) כדאי לחזור עליהם.
2. הסבר בקצרה מהי הנקודה הקלינית שדורשת חיזוק כדי למנוע טעות דומה במבחן.`;

  return await callGeminiWithFallback(apiKey, prompt, false);
}

const getFallbackLesson = (topic: string, duration: number) => {
  const cfg = getDurationConfig(duration);
  return {
    blocks: Array.from({ length: cfg.blocksCount }, (_, i) => ({
      title: `שלב למידה ${i + 1}: יסודות ${topic}`,
      explanation: `זהו בלוק למידה אינטראקטיבי מספר ${i + 1} המותאם לסשן של ${duration} דקות. חבר מפתח Gemini API בהגדרות כדי לקבל ניתוח מלא מתוך הקבצים שלך ללא איבוד מידע. בכל שלב תידרש לענות על שאלת הבנה ולקבל משוב קליני מיידי לפני שייפתח השלב הבא.`,
      checkQuestion: `שאלת בדיקה לשלב ${i + 1}: מה נדרש כדי לפתוח את השלב הבא בלמידה?`,
      options: ['מענה נכון על שאלת ההבנה הנוכחית', 'דילוג ישיר לבוחן', 'סגירת הדפדפן', 'מחיקת הקורס'],
      correctIndex: 0,
      feedbackByOption: [
        'מדויק! הלמידה בנויה בצורה מדורגת כך שכל שלב נפתח לאחר הבנת השלב הקודם.',
        'לא ניתן לדלג לבוחן לפני השלמת כל שלבי ההוראה.',
        'סגירת הדפדפן לא תקדם אותך בפרק.',
        'ממש לא, אנחנו רוצים לסיים את הקורס בהצלחה.'
      ],
    })),
    comparisonTable: [{ param: 'מצב מערכת', acute: 'מצב הדגמה', chronic: 'מחובר ל-AI' }],
  };
};

// ==========================================
// 5. מנוע הקראה בעברית (Google TTS Audio Queue)
// ==========================================
function splitTextToHebrewAudioChunks(text: string, maxLen = 175): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];

  const sentences = cleaned.split(/(?<=[.!?।:;])\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + ' ' + sentence).trim().length <= maxLen) {
      current = (current + ' ' + sentence).trim();
    } else {
      if (current) chunks.push(current);
      if (sentence.length <= maxLen) {
        current = sentence;
      } else {
        const words = sentence.split(' ');
        let wBuf = '';
        for (const w of words) {
          if ((wBuf + ' ' + w).trim().length <= maxLen) {
            wBuf = (wBuf + ' ' + w).trim();
          } else {
            if (wBuf) chunks.push(wBuf);
            wBuf = w;
          }
        }
        current = wBuf;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// ==========================================
// 6. הקומפוננטה הראשית
// ==========================================
export default function App() {
  const [darkMode, setDarkMode] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('medstudy_api_key') || '');
  const [userName, setUserName] = useState(() => localStorage.getItem('medstudy_user_name') || '');
  const [showSettings, setShowSettings] = useState(() => !localStorage.getItem('medstudy_api_key'));

  const [courses, setCourses] = useState<any[]>([]);
  const [isDBLoaded, setIsDBLoaded] = useState(false);
  const [activeCourseId, setActiveCourseId] = useState<string | null>(() => localStorage.getItem('medstudy_active_course') || null);
  const [step, setStep] = useState<number>(1);

  const [isAddingMaterialMode, setIsAddingMaterialMode] = useState(false);
  const [courseName, setCourseName] = useState('');
  const [files, setFiles] = useState<any[]>([]);
  const [isParsingFiles, setIsParsingFiles] = useState(false);
  const [deadline, setDeadline] = useState('');
  const [selectedDays, setSelectedDays] = useState<number[]>([0, 2, 4]);
  const [sessionDuration, setSessionDuration] = useState<number>(60);

  const [isPlanningAI, setIsPlanningAI] = useState(false);
  const [draftPlan, setDraftPlan] = useState<any>(null);

  const [activeSession, setActiveSession] = useState<any>(null);
  const [studyContent, setStudyContent] = useState<any>(null);
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [activeTab, setActiveTab] = useState<'learn' | 'flashcards' | 'quiz' | 'game'>('learn');

  const [unlockedBlockIdx, setUnlockedBlockIdx] = useState<number>(0);
  const [blockAnswers, setBlockAnswers] = useState<Record<number, number>>({});
  const [isLessonMastered, setIsLessonMastered] = useState<boolean>(false);

  const [isLoadingTabContent, setIsLoadingTabContent] = useState(false);

  // סטטוס טעינה מוקדמת ברקע של כרטיסיות, בוחן ו-Code Blue
  const [bgPrefetchStatus, setBgPrefetchStatus] = useState<{
    flashcards: 'idle' | 'loading' | 'ready';
    quiz: 'idle' | 'loading' | 'ready';
    game: 'idle' | 'loading' | 'ready';
  }>({ flashcards: 'idle', quiz: 'idle', game: 'idle' });
  const bgPrefetchRunIdRef = useRef<number>(0);

  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);

  // כרטיסיות + Spaced Repetition
  const [cardIndex, setCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [knownCards, setKnownCards] = useState<number[]>([]);
  const [warmupCardIdx, setWarmupCardIdx] = useState(0);
  const [warmupFlipped, setWarmupFlipped] = useState(false);
  const [showWarmupBanner, setShowWarmupBanner] = useState(true);

  // בוחן מסכם + היסטוריה + המלצות חזרה
  const [activeQuizAttemptIdx, setActiveQuizAttemptIdx] = useState<number>(0);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizWeaknessFeedback, setQuizWeaknessFeedback] = useState<string>('');
  const [isAnalyzingQuiz, setIsAnalyzingQuiz] = useState(false);

  // Code Blue + היסטוריה + המלצות חזרה
  const [activeCodeBlueAttemptIdx, setActiveCodeBlueAttemptIdx] = useState<number>(0);
  const [gameStarted, setGameStarted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(60);
  const [caseIndex, setCaseIndex] = useState(0);
  const [patientStability, setPatientStability] = useState(100);
  const [streak, setStreak] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [codeBlueAnswers, setCodeBlueAnswers] = useState<Record<number, number>>({});
  const [codeBlueWeaknessFeedback, setCodeBlueWeaknessFeedback] = useState<string>('');
  const [isAnalyzingCodeBlue, setIsAnalyzingCodeBlue] = useState(false);

  // מודאל מרתון טעויות + תצוגת סיכום כיס להדפסה
  const [showMistakesModal, setShowMistakesModal] = useState(false);
  const [marathonQuestions, setMarathonQuestions] = useState<any[] | null>(null);
  const [marathonAnswers, setMarathonAnswers] = useState<Record<number, number>>({});
  const [marathonSubmitted, setMarathonSubmitted] = useState(false);
  const [isGeneratingMarathon, setIsGeneratingMarathon] = useState(false);

  const [pocketSummaryScope, setPocketSummaryScope] = useState<'session' | 'course' | null>(null);

  // חיפוש חכם חוצה-קורס
  const [courseSearchQuery, setCourseSearchQuery] = useState('');

  // הקראה קולית בעברית (Audio Ref Queue)
  const [speakingBlockKey, setSpeakingBlockKey] = useState<string | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const speechAbortRef = useRef<boolean>(false);

  const activeCourse = courses.find((c) => c.id === activeCourseId) || null;

  useEffect(() => {
    (async () => {
      try {
        let loaded = await loadCoursesFromIDB();
        if (loaded.length === 0) {
          const legacyRaw = localStorage.getItem('medstudy_courses');
          if (legacyRaw) {
            loaded = JSON.parse(legacyRaw);
            if (loaded.length > 0) {
              await saveCoursesToIDB(loaded);
              localStorage.removeItem('medstudy_courses');
            }
          }
        }
        const hydrated = loaded.map((c: any) => ({
          ...c,
          mistakesBank: c.mistakesBank || [],
          reviewCardsBank: c.reviewCardsBank || [],
          schedule: (c.schedule || []).map((s: any) => ({ ...s, rawDate: new Date(s.rawDate) })),
        }));
        setCourses(hydrated);
        if (hydrated.length > 0) setStep(0);
      } catch (e) {
        console.error('שגיאה בטעינת מסד הנתונים:', e);
      } finally {
        setIsDBLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!isDBLoaded) return;
    saveCoursesToIDB(courses).catch((e) => console.error('שגיאת שמירה ב-IndexedDB:', e));
    if (activeCourseId) localStorage.setItem('medstudy_active_course', activeCourseId);
  }, [courses, activeCourseId, isDBLoaded]);

  useEffect(() => {
    if (!gameStarted || gameOver || activeTab !== 'game') return;
    if (timeLeft <= 0) {
      finishCodeBlueRun(codeBlueAnswers, patientStability, streak);
      return;
    }
    const timer = setInterval(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearInterval(timer);
  }, [gameStarted, gameOver, timeLeft, activeTab]);

  useEffect(() => {
    return () => {
      stopSpeech();
    };
  }, [step, activeTab]);

  const stopSpeech = () => {
    speechAbortRef.current = true;
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current.src = '';
      audioPlayerRef.current = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setSpeakingBlockKey(null);
  };

  const toggleSpeech = async (key: string, textToRead: string) => {
    if (speakingBlockKey === key) {
      stopSpeech();
      return;
    }

    stopSpeech();
    speechAbortRef.current = false;
    setSpeakingBlockKey(key);

    const chunks = splitTextToHebrewAudioChunks(textToRead, 175);
    if (chunks.length === 0) {
      setSpeakingBlockKey(null);
      return;
    }

    for (let i = 0; i < chunks.length; i++) {
      if (speechAbortRef.current) break;

      const chunk = chunks[i];
      const hasHebrew = /[\u0590-\u05FF]/.test(chunk);
      const lang = hasHebrew ? 'he' : 'en';
      const ttsUrl = `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(chunk)}`;

      try {
        await new Promise<void>((resolve, reject) => {
          if (speechAbortRef.current) {
            resolve();
            return;
          }
          const audio = new Audio(ttsUrl);
          audioPlayerRef.current = audio;
          audio.playbackRate = 1.08;
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error('TTS Audio Error'));
          audio.play().catch(reject);
        });
      } catch {
        if ('speechSynthesis' in window && !speechAbortRef.current) {
          await new Promise<void>((resolve) => {
            const utter = new SpeechSynthesisUtterance(chunk);
            utter.lang = hasHebrew ? 'he-IL' : 'en-US';
            utter.onend = () => resolve();
            utter.onerror = () => resolve();
            window.speechSynthesis.speak(utter);
          });
        }
      }
    }

    if (!speechAbortRef.current) {
      setSpeakingBlockKey(null);
    }
  };

  const saveApiKey = (val: string) => {
    setApiKey(val);
    localStorage.setItem('medstudy_api_key', val);
  };

  const saveUserName = (val: string) => {
    setUserName(val);
    localStorage.setItem('medstudy_user_name', val);
  };

  const recordMistakesToCourseBank = (
    newMistakes: {
      source: string;
      sessionTopic: string;
      question: string;
      userAnswer: string;
      correctAnswer: string;
      rationale?: string;
    }[]
  ) => {
    if (!activeCourse || newMistakes.length === 0) return;
    setCourses((prev) =>
      prev.map((c) => {
        if (c.id !== activeCourse.id) return c;
        const existing = c.mistakesBank || [];
        const merged = [...existing];
        newMistakes.forEach((m) => {
          const alreadyExists = merged.some((ex: any) => ex.question === m.question);
          if (!alreadyExists) {
            merged.unshift({
              id: 'err-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
              createdAt: new Date().toLocaleDateString('he-IL'),
              ...m,
            });
          }
        });
        return { ...c, mistakesBank: merged };
      })
    );
  };

  const removeMistakeFromBank = (mistakeId: string) => {
    if (!activeCourse) return;
    setCourses((prev) =>
      prev.map((c) =>
        c.id === activeCourse.id
          ? { ...c, mistakesBank: (c.mistakesBank || []).filter((m: any) => m.id !== mistakeId) }
          : c
      )
    );
  };

  const addCardToSpacedRepetition = (card: { front: string; back: string }, sessionTopic: string) => {
    if (!activeCourse) return;
    setCourses((prev) =>
      prev.map((c) => {
        if (c.id !== activeCourse.id) return c;
        const existing = c.reviewCardsBank || [];
        if (existing.some((item: any) => item.front === card.front)) return c;
        return {
          ...c,
          reviewCardsBank: [
            ...existing,
            {
              id: 'sr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
              front: card.front,
              back: card.back,
              sessionTopic,
              addedAt: new Date().toLocaleDateString('he-IL'),
            },
          ],
        };
      })
    );
  };

  const removeCardFromSpacedRepetition = (cardFront: string) => {
    if (!activeCourse) return;
    setCourses((prev) =>
      prev.map((c) =>
        c.id === activeCourse.id
          ? {
              ...c,
              reviewCardsBank: (c.reviewCardsBank || []).filter((item: any) => item.front !== cardFront),
            }
          : c
      )
    );
  };

  const openNewCourseForm = () => {
    setIsAddingMaterialMode(false);
    setCourseName('');
    setFiles([]);
    setDeadline('');
    setSelectedDays([0, 2, 4]);
    setSessionDuration(60);
    setDraftPlan(null);
    setStep(1);
  };

  const openAddMaterialToCourse = () => {
    if (!activeCourse) return;
    setIsAddingMaterialMode(true);
    setCourseName(activeCourse.title);
    setFiles([]);
    setDeadline(activeCourse.deadline);
    setSelectedDays(activeCourse.selectedDays || [0, 2, 4]);
    setSessionDuration(activeCourse.sessionDuration || 60);
    setDraftPlan(null);
    setStep(1);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = Array.from(e.target.files || []);
    setIsParsingFiles(true);
    try {
      const processed = await Promise.all(
        uploadedFiles.map(async (file) => {
          const extractedText = await extractTextFromFile(file);
          return {
            id: Math.random().toString(36).substr(2, 9),
            name: file.name,
            size: (file.size / 1024 / 1024).toFixed(2) + ' MB',
            type: file.name.split('.').pop()?.toUpperCase(),
            text: extractedText || 'לא נמצא טקסט קריא.',
            wordCount: extractedText ? extractedText.split(/\s+/).length : 0,
          };
        })
      );
      setFiles((prev) => [...prev, ...processed]);
    } catch (err: any) {
      alert('שגיאה בקריאת הקובץ: ' + err.message);
    } finally {
      setIsParsingFiles(false);
    }
  };

  const removeFile = (id: string) => setFiles(files.filter((f) => f.id !== id));

  const toggleDay = (dayId: number) => {
    setSelectedDays((prev) => (prev.includes(dayId) ? prev.filter((d) => d !== dayId) : [...prev, dayId]));
  };

  const generateAIDraftPlan = async () => {
    if (files.length === 0 || !deadline || selectedDays.length === 0) {
      alert('אנא העלה לפחות קובץ אחד, בחר דדליין וסמן ימי לימוד.');
      return;
    }

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(deadline);
    end.setHours(23, 59, 59, 999);

    if (end <= start) {
      alert('תאריך היעד חייב להיות בעתיד.');
      return;
    }

    const studyDates: Date[] = [];
    let current = new Date(start);
    while (current <= end) {
      if (selectedDays.includes(current.getDay())) {
        studyDates.push(new Date(current));
      }
      current.setDate(current.getDate() + 1);
    }

    if (studyDates.length === 0) {
      alert('לא נמצאו ימי לימוד תואמים בטווח התאריכים.');
      return;
    }

    const completedSessions = isAddingMaterialMode && activeCourse
      ? activeCourse.schedule.filter((s: any) => s.completed)
      : [];

    const uncompletedOldFiles = isAddingMaterialMode && activeCourse
      ? activeCourse.schedule
          .filter((s: any) => !s.completed)
          .map((s: any) => ({
            name: s.topic,
            text: s.textChunk,
            wordCount: s.textChunk.split(/\s+/).length,
          }))
      : [];

    const allFilesToSchedule = [...uncompletedOldFiles, ...files];
    const naturalUnits = extractNaturalTopicUnits(allFilesToSchedule);

    if (apiKey.trim()) {
      setIsPlanningAI(true);
      try {
        const organized = await organizeUnitsPedagogicallyWithAI(
          apiKey.trim(),
          naturalUnits,
          studyDates.length,
          sessionDuration
        );

        setDraftPlan({
          strategy: organized.strategy,
          dates: studyDates,
          sessions: organized.sessions,
          preservedCompleted: completedSessions,
        });
        setStep(1.5);
      } catch (err: any) {
        console.warn('עובר לחלוקה מאוזנת מקומית:', err);
        const fallbackSessions = fallbackBalancedMerge(naturalUnits, studyDates.length);
        setDraftPlan({
          strategy: 'חלוקה ליחידות נושאיות שלמות מתוך הקבצים.',
          dates: studyDates,
          sessions: fallbackSessions,
          preservedCompleted: completedSessions,
        });
        setStep(1.5);
      } finally {
        setIsPlanningAI(false);
      }
    } else {
      const fallbackSessions = fallbackBalancedMerge(naturalUnits, studyDates.length);
      setDraftPlan({
        strategy: 'חלוקה ליחידות נושאיות שלמות מתוך הקבצים.',
        dates: studyDates,
        sessions: fallbackSessions,
        preservedCompleted: completedSessions,
      });
      setStep(1.5);
    }
  };

  const moveDraftSession = (index: number, direction: number) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= draftPlan.sessions.length) return;
    const updated = [...draftPlan.sessions];
    const temp = updated[index];
    updated[index] = updated[targetIdx];
    updated[targetIdx] = temp;
    setDraftPlan({ ...draftPlan, sessions: updated });
  };

  const updateDraftSessionTitle = (index: number, newTitle: string) => {
    const updated = [...draftPlan.sessions];
    updated[index] = { ...updated[index], title: newTitle };
    setDraftPlan({ ...draftPlan, sessions: updated });
  };

  const confirmAndSaveCourse = () => {
    if (!draftPlan) return;

    const preserved = draftPlan.preservedCompleted || [];
    const newScheduleItems = draftPlan.dates.map((date: Date, index: number) => {
      const s = draftPlan.sessions[index];
      return {
        id: preserved.length + index + 1,
        date: date.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'short' }),
        rawDate: date,
        topic: s.title,
        rationale: s.rationale,
        textChunk: s.textChunk,
        duration: sessionDuration,
        completed: false,
        savedContent: null,
      };
    });

    const combinedSchedule = [...preserved, ...newScheduleItems];

    if (isAddingMaterialMode && activeCourse) {
      setCourses((prev) =>
        prev.map((c) =>
          c.id === activeCourse.id
            ? {
                ...c,
                deadline,
                selectedDays,
                sessionDuration,
                filesCount: c.filesCount + files.length,
                schedule: combinedSchedule,
              }
            : c
        )
      );
      setIsAddingMaterialMode(false);
      setDraftPlan(null);
      setStep(2);
      return;
    }

    const newCourse = {
      id: 'course-' + Date.now(),
      title: courseName.trim() || `קורס סיעוד ${courses.length + 1}`,
      strategy: draftPlan.strategy,
      deadline,
      selectedDays,
      sessionDuration,
      filesCount: files.length,
      schedule: combinedSchedule,
      mistakesBank: [],
      reviewCardsBank: [],
      createdAt: new Date().toLocaleDateString('he-IL'),
    };

    setCourses((prev) => [newCourse, ...prev]);
    setActiveCourseId(newCourse.id);
    setDraftPlan(null);
    setStep(2);
  };

  const deleteCourse = (courseId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('האם למחוק קורס זה לצמיתות?')) return;
    const updated = courses.filter((c) => c.id !== courseId);
    setCourses(updated);
    if (activeCourseId === courseId) {
      setActiveCourseId(updated[0]?.id || null);
      setStep(updated.length > 0 ? 0 : 1);
    }
  };

  const exportToCalendarTasks = () => {
    if (!activeCourse) return;
    const formatDateOnly = (dateObj: Date) => {
      const y = dateObj.getFullYear();
      const m = String(dateObj.getMonth() + 1).padStart(2, '0');
      const d = String(dateObj.getDate()).padStart(2, '0');
      return `${y}${m}${d}`;
    };

    let icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//MedStudy AI//Nursing Study Tasks//HE',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ];

    activeCourse.schedule
      .filter((s: any) => !s.completed)
      .forEach((session: any) => {
        const dateStr = formatDateOnly(session.rawDate);
        icsContent.push(
          'BEGIN:VEVENT',
          `UID:event-medstudy-${activeCourse.id}-${session.id}-${Date.now()}@medstudy.ai`,
          `DTSTART;VALUE=DATE:${dateStr}`,
          `DTEND;VALUE=DATE:${dateStr}`,
          `SUMMARY:🩺 [${activeCourse.title}] ${session.topic} (${session.duration} דק׳)`,
          `DESCRIPTION:${session.rationale || 'יעד למידה מתוך MedStudy AI'}.`,
          'END:VEVENT'
        );
      });

    icsContent.push('END:VCALENDAR');

    const blob = new Blob([icsContent.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `${activeCourse.title}_Nursing_Tasks.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const updateSessionSavedContent = (sessionId: number, patch: any) => {
    setStudyContent((prev: any) => {
      const merged = { ...(prev || {}), ...patch };
      if (activeCourse) {
        setCourses((cList) =>
          cList.map((c) =>
            c.id === activeCourse.id
              ? {
                  ...c,
                  schedule: c.schedule.map((s: any) => (s.id === sessionId ? { ...s, savedContent: merged } : s)),
                }
              : c
          )
        );
      }
      return merged;
    });
  };

  const loadQuizAttemptState = (attempt: any, idx: number) => {
    setActiveQuizAttemptIdx(idx);
    setQuizAnswers(attempt.answers || {});
    setQuizSubmitted(Boolean(attempt.submitted));
    setQuizWeaknessFeedback(attempt.weaknessFeedback || '');
  };

  const loadCodeBlueAttemptState = (attempt: any, idx: number) => {
    setActiveCodeBlueAttemptIdx(idx);
    setCodeBlueAnswers(attempt.answers || {});
    setCodeBlueWeaknessFeedback(attempt.weaknessFeedback || '');
    if (attempt.completed) {
      setGameStarted(true);
      setGameOver(true);
      setPatientStability(attempt.finalStability ?? 100);
      setStreak(attempt.finalStreak ?? 0);
    } else {
      setGameStarted(false);
      setGameOver(false);
      setTimeLeft(60);
      setCaseIndex(0);
      setPatientStability(100);
      setStreak(0);
    }
  };

  // ==========================================
  // טעינה מקדימה מדורגת ברקע (עם ביקורת מנכ"ל)
  // ==========================================
  const prefetchSessionExtrasInBackground = async (session: any, currentContent: any) => {
    const runId = ++bgPrefetchRunIdRef.current;
    const key = apiKey.trim();

    const needCards = !currentContent?.flashcards || currentContent.flashcards.length === 0;
    const needQuiz = !currentContent?.quizAttempts || currentContent.quizAttempts.length === 0;
    const needGame = !currentContent?.codeBlueAttempts || currentContent.codeBlueAttempts.length === 0;

    setBgPrefetchStatus({
      flashcards: needCards ? 'loading' : 'ready',
      quiz: needQuiz ? 'loading' : 'ready',
      game: needGame ? 'loading' : 'ready',
    });

    if (!needCards && !needQuiz && !needGame) return;

    if (!key) {
      const demoPatch: any = {};
      if (needCards) {
        demoPatch.flashcards = [{ id: 1, front: 'מצב הדגמה', back: 'חבר מפתח API בהגדרות כדי לייצר כרטיסיות מתוך החומר.' }];
      }
      if (needQuiz) {
        demoPatch.quizAttempts = [
          {
            id: 'quiz-' + Date.now(),
            createdAt: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
            questions: [{ q: 'שאלת הדגמה', opts: ['תשובה נכונה', 'מסיח'], ans: 0, explanation: 'הסבר' }],
            answers: {},
            submitted: false,
            score: null,
            weaknessFeedback: '',
          },
        ];
      }
      if (needGame) {
        demoPatch.codeBlueAttempts = [
          {
            id: 'cb-' + Date.now(),
            createdAt: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
            cases: [{ scenario: 'תרחיש הדגמה', question: 'מה עושים?', options: ['פעולה נכונה', 'טעות'], correct: 0, rationale: 'הסבר' }],
            answers: {},
            completed: false,
            finalStability: 100,
            finalStreak: 0,
            weaknessFeedback: '',
          },
        ];
      }
      updateSessionSavedContent(session.id, demoPatch);
      setBgPrefetchStatus({ flashcards: 'ready', quiz: 'ready', game: 'ready' });
      return;
    }

    // הרצה מדורגת ברקע כדי לשמור על יציבות מול מגבלת הקצב בזמן ביקורת המנכ"ל
    if (needCards && bgPrefetchRunIdRef.current === runId) {
      try {
        const cards = await generateFlashcardsOnly(key, session.textChunk, session.duration);
        if (bgPrefetchRunIdRef.current === runId) {
          updateSessionSavedContent(session.id, { flashcards: cards });
          setBgPrefetchStatus((prev) => ({ ...prev, flashcards: 'ready' }));
        }
      } catch (e) {
        console.warn('שגיאת טעינה מקדימה של כרטיסיות:', e);
        if (bgPrefetchRunIdRef.current === runId) setBgPrefetchStatus((prev) => ({ ...prev, flashcards: 'idle' }));
      }
    }

    if (needQuiz && bgPrefetchRunIdRef.current === runId) {
      try {
        const quiz = await generateQuizOnly(key, session.textChunk, session.duration);
        if (bgPrefetchRunIdRef.current === runId) {
          const newAttempt = {
            id: 'quiz-' + Date.now(),
            createdAt: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
            questions: quiz,
            answers: {},
            submitted: false,
            score: null,
            weaknessFeedback: '',
          };
          updateSessionSavedContent(session.id, { quizAttempts: [newAttempt] });
          setActiveQuizAttemptIdx(0);
          setQuizAnswers({});
          setQuizSubmitted(false);
          setQuizWeaknessFeedback('');
          setBgPrefetchStatus((prev) => ({ ...prev, quiz: 'ready' }));
        }
      } catch (e) {
        console.warn('שגיאת טעינה מקדימה של בוחן:', e);
        if (bgPrefetchRunIdRef.current === runId) setBgPrefetchStatus((prev) => ({ ...prev, quiz: 'idle' }));
      }
    }

    if (needGame && bgPrefetchRunIdRef.current === runId) {
      try {
        const cases = await generateCodeBlueOnly(key, session.textChunk);
        if (bgPrefetchRunIdRef.current === runId) {
          const newAttempt = {
            id: 'cb-' + Date.now(),
            createdAt: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
            cases,
            answers: {},
            completed: false,
            finalStability: 100,
            finalStreak: 0,
            weaknessFeedback: '',
          };
          updateSessionSavedContent(session.id, { codeBlueAttempts: [newAttempt] });
          setActiveCodeBlueAttemptIdx(0);
          setCodeBlueAnswers({});
          setCodeBlueWeaknessFeedback('');
          setBgPrefetchStatus((prev) => ({ ...prev, game: 'ready' }));
        }
      } catch (e) {
        console.warn('שגיאת טעינה מקדימה של Code Blue:', e);
        if (bgPrefetchRunIdRef.current === runId) setBgPrefetchStatus((prev) => ({ ...prev, game: 'idle' }));
      }
    }
  };

  const startSession = async (session: any) => {
    stopSpeech();
    setActiveSession(session);
    setActiveTab('learn');
    setUnlockedBlockIdx(session.completed ? 999 : 0);
    setBlockAnswers({});
    setIsLessonMastered(session.completed);
    setCardIndex(0);
    setIsFlipped(false);
    setKnownCards([]);
    setWarmupCardIdx(0);
    setWarmupFlipped(false);
    setShowWarmupBanner(true);
    setQuizAnswers({});
    setQuizSubmitted(false);
    setQuizWeaknessFeedback('');
    setGameStarted(false);
    setGameOver(false);
    setCodeBlueWeaknessFeedback('');
    setStep(3);

    const cleanName = userName.trim();
    const greeting = cleanName ? `היי ${cleanName}!` : 'היי!';

    setChatMessages([
      {
        role: 'ai',
        text: `${greeting} התחלנו את "${session.topic}" (${session.duration} דקות). השיעור עבר בקרת איכות קלינית קפדנית, ובזמן הלמידה אני מכין ומשייף ברקע גם את הכרטיסיות, הבוחן ו-Code Blue!`,
      },
    ]);

    if (session.savedContent?.blocks) {
      let existing = { ...session.savedContent };
      if (!existing.quizAttempts && existing.chapterQuiz) {
        existing.quizAttempts = [
          {
            id: 'quiz-' + Date.now(),
            createdAt: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
            questions: existing.chapterQuiz,
            answers: {},
            submitted: false,
            score: null,
            weaknessFeedback: '',
          },
        ];
      }
      if (!existing.codeBlueAttempts && existing.codeBlueCases) {
        existing.codeBlueAttempts = [
          {
            id: 'cb-' + Date.now(),
            createdAt: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
            cases: existing.codeBlueCases,
            answers: {},
            completed: false,
            finalStability: 100,
            finalStreak: 0,
            weaknessFeedback: '',
          },
        ];
      }

      setStudyContent(existing);
      if (existing.quizAttempts?.length > 0) {
        loadQuizAttemptState(existing.quizAttempts[0], 0);
      }
      if (existing.codeBlueAttempts?.length > 0) {
        loadCodeBlueAttemptState(existing.codeBlueAttempts[0], 0);
      }

      prefetchSessionExtrasInBackground(session, existing);
      return;
    }

    if (apiKey.trim()) {
      setIsLoadingAI(true);
      try {
        const lessonData = await generateInteractiveLessonBlocks(
          apiKey.trim(),
          session.topic,
          session.textChunk,
          session.duration
        );
        setStudyContent(lessonData);
        updateSessionSavedContent(session.id, lessonData);
        setIsLoadingAI(false);

        prefetchSessionExtrasInBackground(session, lessonData);
      } catch (err: any) {
        setIsLoadingAI(false);
        alert('שגיאה בבניית השיעור: ' + err.message);
        const fb = getFallbackLesson(session.topic, session.duration);
        setStudyContent(fb);
      }
    } else {
      const fb = getFallbackLesson(session.topic, session.duration);
      setStudyContent(fb);
      prefetchSessionExtrasInBackground(session, fb);
    }
  };

  const handleBlockOptionSelect = (blockIdx: number, optIdx: number, correctIdx: number, totalBlocks: number) => {
    setBlockAnswers((prev) => ({ ...prev, [blockIdx]: optIdx }));

    const block = studyContent?.blocks?.[blockIdx];
    if (optIdx !== correctIdx && block && activeSession) {
      recordMistakesToCourseBank([
        {
          source: 'שיעור מודרך',
          sessionTopic: activeSession.topic,
          question: block.checkQuestion,
          userAnswer: block.options[optIdx],
          correctAnswer: block.options[correctIdx],
          rationale: block.feedbackByOption?.[correctIdx],
        },
      ]);
    }

    if (optIdx === correctIdx) {
      if (blockIdx + 1 < totalBlocks) {
        setUnlockedBlockIdx((prev) => Math.max(prev, blockIdx + 1));
      } else {
        setIsLessonMastered(true);
        if (activeCourse && activeSession) {
          setCourses((prev) =>
            prev.map((course) =>
              course.id === activeCourse.id
                ? {
                    ...course,
                    schedule: course.schedule.map((s: any) =>
                      s.id === activeSession.id ? { ...s, completed: true } : s
                    ),
                  }
                : course
            )
          );
        }
      }
    }
  };

  const createAndAppendQuizAttempt = async () => {
    const existingAttempts = studyContent?.quizAttempts || [];
    if (!apiKey.trim()) {
      const demoAttempt = {
        id: 'quiz-' + Date.now(),
        createdAt: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
        questions: [{ q: 'שאלת הדגמה', opts: ['תשובה נכונה', 'מסיח'], ans: 0, explanation: 'הסבר' }],
        answers: {},
        submitted: false,
        score: null,
        weaknessFeedback: '',
      };
      const nextAttempts = [demoAttempt, ...existingAttempts];
      updateSessionSavedContent(activeSession.id, { quizAttempts: nextAttempts });
      loadQuizAttemptState(demoAttempt, 0);
      return;
    }

    setIsLoadingTabContent(true);
    try {
      const quiz = await generateQuizOnly(apiKey.trim(), activeSession.textChunk, activeSession.duration);
      const newAttempt = {
        id: 'quiz-' + Date.now(),
        createdAt: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
        questions: quiz,
        answers: {},
        submitted: false,
        score: null,
        weaknessFeedback: '',
      };
      const nextAttempts = [newAttempt, ...existingAttempts];
      updateSessionSavedContent(activeSession.id, { quizAttempts: nextAttempts });
      loadQuizAttemptState(newAttempt, 0);
      setBgPrefetchStatus((prev) => ({ ...prev, quiz: 'ready' }));
    } catch (err: any) {
      alert('שגיאה ביצירת הבוחן: ' + err.message);
    } finally {
      setIsLoadingTabContent(false);
    }
  };

  const createAndAppendCodeBlueAttempt = async () => {
    const existingAttempts = studyContent?.codeBlueAttempts || [];
    if (!apiKey.trim()) {
      const demoAttempt = {
        id: 'cb-' + Date.now(),
        createdAt: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
        cases: [{ scenario: 'תרחיש הדגמה', question: 'מה עושים?', options: ['פעולה נכונה', 'טעות'], correct: 0, rationale: 'הסבר' }],
        answers: {},
        completed: false,
        finalStability: 100,
        finalStreak: 0,
        weaknessFeedback: '',
      };
      const nextAttempts = [demoAttempt, ...existingAttempts];
      updateSessionSavedContent(activeSession.id, { codeBlueAttempts: nextAttempts });
      loadCodeBlueAttemptState(demoAttempt, 0);
      return;
    }

    setIsLoadingTabContent(true);
    try {
      const cases = await generateCodeBlueOnly(apiKey.trim(), activeSession.textChunk);
      const newAttempt = {
        id: 'cb-' + Date.now(),
        createdAt: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
        cases,
        answers: {},
        completed: false,
        finalStability: 100,
        finalStreak: 0,
        weaknessFeedback: '',
      };
      const nextAttempts = [newAttempt, ...existingAttempts];
      updateSessionSavedContent(activeSession.id, { codeBlueAttempts: nextAttempts });
      loadCodeBlueAttemptState(newAttempt, 0);
      setBgPrefetchStatus((prev) => ({ ...prev, game: 'ready' }));
    } catch (err: any) {
      alert('שגיאה ביצירת סימולציית Code Blue: ' + err.message);
    } finally {
      setIsLoadingTabContent(false);
    }
  };

  const handleTabSwitch = async (targetTab: 'learn' | 'flashcards' | 'quiz' | 'game') => {
    if (targetTab !== 'learn' && !isLessonMastered) {
      return;
    }

    stopSpeech();
    setActiveTab(targetTab);

    if (targetTab === 'flashcards' && !studyContent?.flashcards && bgPrefetchStatus.flashcards !== 'loading') {
      if (!apiKey.trim()) {
        updateSessionSavedContent(activeSession.id, {
          flashcards: [{ id: 1, front: 'מצב הדגמה', back: 'חבר מפתח API ליצירת כרטיסיות.' }],
        });
        return;
      }
      setIsLoadingTabContent(true);
      try {
        const cards = await generateFlashcardsOnly(apiKey.trim(), activeSession.textChunk, activeSession.duration);
        updateSessionSavedContent(activeSession.id, { flashcards: cards });
        setBgPrefetchStatus((prev) => ({ ...prev, flashcards: 'ready' }));
      } catch (err: any) {
        alert('שגיאה ביצירת כרטיסיות: ' + err.message);
      } finally {
        setIsLoadingTabContent(false);
      }
    }

    if (
      targetTab === 'quiz' &&
      (!studyContent?.quizAttempts || studyContent.quizAttempts.length === 0) &&
      bgPrefetchStatus.quiz !== 'loading'
    ) {
      await createAndAppendQuizAttempt();
    }

    if (
      targetTab === 'game' &&
      (!studyContent?.codeBlueAttempts || studyContent.codeBlueAttempts.length === 0) &&
      bgPrefetchStatus.game !== 'loading'
    ) {
      await createAndAppendCodeBlueAttempt();
    }
  };

  const regenerateNewCards = async () => {
    if (!apiKey.trim()) return;
    setIsLoadingTabContent(true);
    try {
      const cards = await generateFlashcardsOnly(apiKey.trim(), activeSession.textChunk, activeSession.duration);
      updateSessionSavedContent(activeSession.id, { flashcards: cards });
      setCardIndex(0);
      setIsFlipped(false);
      setKnownCards([]);
    } catch (err: any) {
      alert('שגיאה: ' + err.message);
    } finally {
      setIsLoadingTabContent(false);
    }
  };

  const handleSubmitQuiz = async () => {
    const attempts = [...(studyContent?.quizAttempts || [])];
    const currentAttempt = attempts[activeQuizAttemptIdx];
    if (!currentAttempt) return;

    const questions = currentAttempt.questions || [];
    const correctCount = questions.filter((q: any, i: number) => quizAnswers[i] === q.ans).length;

    const mistakes = questions
      .map((q: any, i: number) => {
        if (quizAnswers[i] !== q.ans) {
          return {
            source: 'בוחן מסכם',
            sessionTopic: activeSession.topic,
            question: q.q,
            userAnswer: quizAnswers[i] !== undefined ? q.opts[quizAnswers[i]] : 'לא נענה',
            correctAnswer: q.opts[q.ans],
            rationale: q.explanation,
          };
        }
        return null;
      })
      .filter(Boolean) as any[];

    if (mistakes.length > 0) {
      recordMistakesToCourseBank(mistakes);
    }

    setQuizSubmitted(true);

    let feedbackText = '';
    if (mistakes.length > 0) {
      setIsAnalyzingQuiz(true);
      try {
        feedbackText = await generateWeaknessAnalysis(apiKey.trim(), mistakes, studyContent?.blocks || []);
      } catch (e) {
        feedbackText = 'מומלץ לחזור על סעיפי השיעור המודרך הקשורים לשאלות שטעית בהן.';
      } finally {
        setIsAnalyzingQuiz(false);
      }
    }

    setQuizWeaknessFeedback(feedbackText);

    attempts[activeQuizAttemptIdx] = {
      ...currentAttempt,
      answers: { ...quizAnswers },
      submitted: true,
      score: `${correctCount}/${questions.length}`,
      correctCount,
      totalCount: questions.length,
      weaknessFeedback: feedbackText,
    };

    updateSessionSavedContent(activeSession.id, { quizAttempts: attempts });
  };

  const finishCodeBlueRun = async (
    finalAnswers: Record<number, number>,
    finalStab: number,
    finalStrk: number
  ) => {
    setGameOver(true);
    const attempts = [...(studyContent?.codeBlueAttempts || [])];
    const currentAttempt = attempts[activeCodeBlueAttemptIdx];
    if (!currentAttempt) return;

    const cases = currentAttempt.cases || [];
    const mistakes = cases
      .map((c: any, idx: number) => {
        const chosen = finalAnswers[idx];
        if (chosen !== undefined && chosen !== c.correct) {
          return {
            source: 'Code Blue',
            sessionTopic: activeSession.topic,
            question: `${c.scenario} — ${c.question}`,
            userAnswer: c.options[chosen],
            correctAnswer: c.options[c.correct],
            rationale: c.rationale,
          };
        }
        return null;
      })
      .filter(Boolean) as any[];

    if (mistakes.length > 0) {
      recordMistakesToCourseBank(mistakes);
    }

    let feedbackText = '';
    if (mistakes.length > 0) {
      setIsAnalyzingCodeBlue(true);
      try {
        feedbackText = await generateWeaknessAnalysis(apiKey.trim(), mistakes, studyContent?.blocks || []);
      } catch (e) {
        feedbackText = 'מומלץ לחזור על סעיפי השיעור המודרך הרלוונטיים לתרחישים שבהם שגית.';
      } finally {
        setIsAnalyzingCodeBlue(false);
      }
    }

    setCodeBlueWeaknessFeedback(feedbackText);

    attempts[activeCodeBlueAttemptIdx] = {
      ...currentAttempt,
      answers: { ...finalAnswers },
      completed: true,
      finalStability: finalStab,
      finalStreak: finalStrk,
      weaknessFeedback: feedbackText,
    };

    updateSessionSavedContent(activeSession.id, { codeBlueAttempts: attempts });
  };

  const handleStartMistakesMarathon = async () => {
    if (!activeCourse || !(activeCourse.mistakesBank?.length > 0)) return;
    setMarathonSubmitted(false);
    setMarathonAnswers({});

    if (!apiKey.trim()) {
      setMarathonQuestions(
        activeCourse.mistakesBank.slice(0, 5).map((m: any) => ({
          q: m.question,
          opts: [m.correctAnswer, m.userAnswer, 'אפשרות נוספת לבדיקה'],
          ans: 0,
          explanation: m.rationale || 'חזרה מתוך בנק הטעויות של הקורס.',
        }))
      );
      return;
    }

    setIsGeneratingMarathon(true);
    try {
      const generated = await generateMistakesMarathonQuiz(apiKey.trim(), activeCourse.mistakesBank);
      setMarathonQuestions(generated);
    } catch (err: any) {
      alert('שגיאה בבניית מרתון הטעויות: ' + err.message);
    } finally {
      setIsGeneratingMarathon(false);
    }
  };

  const buildActiveScreenContext = () => {
    if (activeTab === 'game') {
      const cbAttempt = studyContent?.codeBlueAttempts?.[activeCodeBlueAttemptIdx];
      if (!cbAttempt) return 'הסטודנט/ית נמצא/ת בטאב Code Blue.';
      if (gameStarted && !gameOver && cbAttempt.cases?.[caseIndex]) {
        const currentCase = cbAttempt.cases[caseIndex];
        return `הסטודנט/ית נמצא/ת כעת באמצע סימולציית חירום Code Blue!
תרחיש מוצג כעת על המסך (תרחיש #${caseIndex + 1} מתוך ${cbAttempt.cases.length}):
- תיאור המקרה והמדדים: ${currentCase.scenario}
- השאלה המוצגת: ${currentCase.question}
- אפשרויות ההתערבות המוצגות על המסך: ${currentCase.options.map((o: string, i: number) => `${i + 1}) ${o}`).join(' | ')}
- ההתערבות הנכונה לפי הפרוטוקול: ${currentCase.options[currentCase.correct]} (נימוק: ${currentCase.rationale})
- מצב יציבות המטופל כעת: ${patientStability}%, זמן שנותר: ${timeLeft} שניות.
הנחיה קריטית: הסטודנט/ית מסתכל/ת על תרחיש זה של Code Blue. ענה לשאלה שלו/ה בהתייחס לתרחיש Code Blue הזה!`;
      }
      if (gameOver && cbAttempt.cases) {
        const summary = cbAttempt.cases
          .map((c: any, idx: number) => {
            const chosen = codeBlueAnswers[idx];
            return `תרחיש #${idx + 1}: ${c.scenario} | שאלה: ${c.question} | הסטודנט בחר: ${chosen !== undefined ? c.options[chosen] : 'לא נענה'} | הנכון: ${c.options[c.correct]} (${c.rationale})`;
          })
          .join('\n');
        return `הסטודנט/ית סיים/ה כעת סימולציית Code Blue ומסתכל/ת על מסך הסיכום של התרחישים:
${summary}
הנחיה: ענה לשאלות הסטודנט/ית בהתייחס לתרחישי Code Blue הללו!`;
      }
      return `הסטודנט/ית נמצא/ת במסך הפתיחה של סימולציית Code Blue לנושא "${activeSession.topic}".`;
    }

    if (activeTab === 'quiz') {
      const qAttempt = studyContent?.quizAttempts?.[activeQuizAttemptIdx];
      if (!qAttempt) return 'הסטודנט/ית נמצא/ת בטאב הבוחן המסכם.';
      const questionsList = (qAttempt.questions || [])
        .map((q: any, idx: number) => {
          const chosen = quizAnswers[idx];
          return `שאלה ${idx + 1}: ${q.q}
אפשרויות: ${q.opts.map((o: string, i: number) => `${i + 1}) ${o}`).join(' | ')}
בחירת הסטודנט: ${chosen !== undefined ? q.opts[chosen] : 'טרם סימן'}
תשובה נכונה: ${q.opts[q.ans]} (הסבר: ${q.explanation})`;
        })
        .join('\n\n');

      return `הסטודנט/ית נמצא/ת כעת בטאב "בוחן מסכם" (סטטוס: ${quizSubmitted ? 'הבוחן הוגש ונבדק' : 'באמצע פתרון הבוחן'}).
אלו השאלות המוצגות כעת על המסך של הסטודנט/ית:
${questionsList}
הנחיה: אם הסטודנט/ית שואל/ת על שאלה מהבוחן, התייחס ישירות לשאלות הבוחן שלמעלה.`;
    }

    if (activeTab === 'flashcards') {
      const currentCard = studyContent?.flashcards?.[cardIndex];
      if (!currentCard) return 'הסטודנט/ית נמצא/ת בטאב כרטיסיות השינון.';
      return `הסטודנט/ית נמצא/ת כעת בטאב "כרטיסיות שינון" (כרטיסייה ${cardIndex + 1} מתוך ${studyContent.flashcards.length}).
הכרטיסייה המוצגת כעת על המסך:
- חזית (מושג/שאלה): ${currentCard.front}
- גב (הסבר קליני): ${currentCard.back}
הנחיה: ענה לשאלות הסטודנט/ית בהתייחס לכרטיסייה המוצגת כעת על המסך.`;
    }

    const blocksContext = (studyContent?.blocks || [])
      .map(
        (b: any, idx: number) =>
          `--- סעיף ${idx + 1} (${idx <= unlockedBlockIdx ? 'פתוח ומוצג כעת על המסך' : 'נעול עדיין'}): ${b.title} ---\n${b.explanation}\nשאלת הבדיקה בסעיף: ${b.checkQuestion}`
      )
      .join('\n\n');

    return `הסטודנט/ית נמצא/ת כעת בטאב "שיעור מודרך".
אלו הסעיפים המוצגים על המסך:
${blocksContext}
הנחיה: אם הסטודנט/ית שואל/ת על סעיף מסוים (למשל "סעיף 1" או "לא הבנתי את הקטע הזה"), התייחס ישירות לסעיף המתאים מהרשימה שלמעלה.`;
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const userMsg = chatInput;
    setChatMessages((prev) => [...prev, { role: 'user', text: userMsg }]);
    setChatInput('');

    if (!apiKey.trim()) {
      setChatMessages((prev) => [
        ...prev,
        { role: 'ai', text: 'כדי שאוכל לענות מתוך המסך והקבצים שלך, הזן מפתח Gemini API בהגדרות למעלה.' },
      ]);
      return;
    }

    setIsChatLoading(true);
    try {
      const studentContext = userName.trim() ? `שם הסטודנט/ית הוא ${userName.trim()}.` : '';
      const screenContext = buildActiveScreenContext();

      const prompt = `אתה מרצה ומדריך קליני בכיר בסיעוד. ${studentContext}
נושא הסשן הנוכחי: "${activeSession.topic}".

=== מה מוצג כרגע על המסך של הסטודנט/ית ===
${screenContext}
=========================================

חומר המקור המלא של הסשן (לגיבוי והעמקה):
${activeSession.textChunk.slice(0, 18000)}

כללי מענה חשובים:
1. שים לב בראש ובראשונה למסך הפעיל של הסטודנט/ית (המתואר למעלה). אם הסטודנט/ית בטאב Code Blue או בוחן או כרטיסיות — אל תניח שהוא/היא מדבר/ת על סעיפי השיעור המודרך, אלא על התרחיש, השאלה או הכרטיסייה שמוצגים לו/לה כעת על המסך!
2. ענה בעברית ברורה, קלינית וממוקדת.

הודעת הסטודנט/ית: ${userMsg}`;

      const reply = await callGeminiWithFallback(apiKey.trim(), prompt, false);
      setChatMessages((prev) => [...prev, { role: 'ai', text: reply || 'לא הצלחתי לנסח תשובה.' }]);
    } catch (err) {
      setChatMessages((prev) => [...prev, { role: 'ai', text: 'שגיאת תקשורת מול ה-AI.' }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const startCodeBlueGame = () => {
    setGameStarted(true);
    setGameOver(false);
    setTimeLeft(60);
    setCaseIndex(0);
    setPatientStability(100);
    setStreak(0);
    setCodeBlueAnswers({});
    setCodeBlueWeaknessFeedback('');
  };

  const handleGameAnswer = (selectedIdx: number, correctIdx: number, totalCases: number) => {
    const updatedAnswers = { ...codeBlueAnswers, [caseIndex]: selectedIdx };
    setCodeBlueAnswers(updatedAnswers);

    let nextStreak = streak;
    let nextStability = patientStability;

    if (selectedIdx === correctIdx) {
      nextStreak = streak + 1;
      nextStability = Math.min(100, patientStability + 10);
      setStreak(nextStreak);
      setPatientStability(nextStability);
    } else {
      nextStreak = 0;
      nextStability = Math.max(0, patientStability - 35);
      setStreak(0);
      setPatientStability(nextStability);
      if (nextStability <= 0) {
        finishCodeBlueRun(updatedAnswers, nextStability, nextStreak);
        return;
      }
    }

    if (caseIndex + 1 < totalCases) {
      setCaseIndex((c) => c + 1);
    } else {
      finishCodeBlueRun(updatedAnswers, nextStability, nextStreak);
    }
  };

  const getCourseAnalytics = (course: any) => {
    if (!course) return null;
    const totalSessions = course.schedule.length;
    const completedSessions = course.schedule.filter((s: any) => s.completed).length;
    const completionPct = totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0;

    const quizPercentages: number[] = [];
    const cbPercentages: number[] = [];
    let weakestSession: { topic: string; mistakesCount: number } | null = null;

    const mistakesByTopic: Record<string, number> = {};
    (course.mistakesBank || []).forEach((m: any) => {
      mistakesByTopic[m.sessionTopic] = (mistakesByTopic[m.sessionTopic] || 0) + 1;
    });

    Object.entries(mistakesByTopic).forEach(([topic, count]) => {
      if (!weakestSession || count > weakestSession.mistakesCount) {
        weakestSession = { topic, mistakesCount: count };
      }
    });

    course.schedule.forEach((s: any) => {
      (s.savedContent?.quizAttempts || []).forEach((att: any) => {
        if (att.submitted && att.score) {
          const [c, t] = String(att.score).split('/').map(Number);
          if (t > 0) quizPercentages.push(Math.round((c / t) * 100));
        }
      });
      (s.savedContent?.codeBlueAttempts || []).forEach((att: any) => {
        if (att.completed) {
          cbPercentages.push(att.finalStability ?? 0);
        }
      });
    });

    const avgQuiz =
      quizPercentages.length > 0
        ? Math.round(quizPercentages.reduce((a, b) => a + b, 0) / quizPercentages.length)
        : null;

    const avgCodeBlue =
      cbPercentages.length > 0
        ? Math.round(cbPercentages.reduce((a, b) => a + b, 0) / cbPercentages.length)
        : null;

    const openMistakes = (course.mistakesBank || []).length;
    const mistakePenalty = Math.min(openMistakes * 3, 25);

    const performanceScore =
      avgQuiz !== null && avgCodeBlue !== null
        ? Math.round((avgQuiz + avgCodeBlue) / 2)
        : avgQuiz !== null
        ? avgQuiz
        : avgCodeBlue !== null
        ? avgCodeBlue
        : completionPct;

    const rawReadiness = Math.round(completionPct * 0.55 + performanceScore * 0.45 - mistakePenalty);
    const readinessScore = Math.max(0, Math.min(100, rawReadiness));

    return {
      completionPct,
      completedSessions,
      totalSessions,
      avgQuiz,
      avgCodeBlue,
      openMistakes,
      readinessScore,
      weakestSession,
    };
  };

  const getCourseSearchResults = (course: any, query: string) => {
    const q = query.trim().toLowerCase();
    if (!course || q.length < 2) return [];

    const results: {
      session: any;
      matchSource: string;
      snippet: string;
    }[] = [];

    course.schedule.forEach((sess: any) => {
      const blocks = sess.savedContent?.blocks || [];
      let matchedInBlock = false;

      blocks.forEach((b: any, bIdx: number) => {
        const combined = `${b.title} ${b.explanation}`;
        const idx = combined.toLowerCase().indexOf(q);
        if (idx !== -1 && !matchedInBlock) {
          matchedInBlock = true;
          const start = Math.max(0, idx - 45);
          const end = Math.min(combined.length, idx + q.length + 75);
          results.push({
            session: sess,
            matchSource: `סעיף ${bIdx + 1}: ${b.title}`,
            snippet: (start > 0 ? '...' : '') + combined.slice(start, end) + (end < combined.length ? '...' : ''),
          });
        }
      });

      if (!matchedInBlock && sess.textChunk) {
        const rawIdx = sess.textChunk.toLowerCase().indexOf(q);
        if (rawIdx !== -1) {
          const start = Math.max(0, rawIdx - 45);
          const end = Math.min(sess.textChunk.length, rawIdx + q.length + 75);
          results.push({
            session: sess,
            matchSource: 'חומר מקור (מצגת / קובץ)',
            snippet:
              (start > 0 ? '...' : '') +
              sess.textChunk.slice(start, end).replace(/\s+/g, ' ') +
              (end < sess.textChunk.length ? '...' : ''),
          });
        }
      }
    });

    return results;
  };

  const currentQuizAttempt = studyContent?.quizAttempts?.[activeQuizAttemptIdx];
  const currentCodeBlueAttempt = studyContent?.codeBlueAttempts?.[activeCodeBlueAttemptIdx];
  const courseReviewCards = activeCourse?.reviewCardsBank || [];
  const courseMistakes = activeCourse?.mistakesBank || [];
  const courseAnalytics = activeCourse ? getCourseAnalytics(activeCourse) : null;
  const searchResults = activeCourse ? getCourseSearchResults(activeCourse, courseSearchQuery) : [];

  const getTabHebrewLabel = () => {
    if (activeTab === 'game') return 'סימולציית Code Blue';
    if (activeTab === 'quiz') return 'בוחן מסכם';
    if (activeTab === 'flashcards') return 'כרטיסיות שינון';
    return 'שיעור מודרך';
  };

  if (pocketSummaryScope && activeCourse) {
    const sessionsToPrint =
      pocketSummaryScope === 'session' && activeSession
        ? [
            {
              ...activeSession,
              savedContent: studyContent || activeSession.savedContent,
            },
          ]
        : activeCourse.schedule.filter((s: any) => s.savedContent?.blocks);

    return (
      <div dir="rtl" className="bg-white text-slate-900 min-h-screen p-8 max-w-4xl mx-auto">
        <div className="flex flex-wrap justify-between items-center gap-4 pb-6 border-b-2 border-slate-900 print:hidden">
          <div>
            <h2 className="text-xl font-bold">תצוגת סיכום כיס קליני להדפסה / PDF</h2>
            <p className="text-xs text-slate-500">לחץ על "הדפס / שמור כ-PDF" ובחר Save as PDF</p>
          </div>
          <div className="flex gap-2.5">
            <button
              onClick={() => window.print()}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold flex items-center gap-2"
            >
              <Printer size={16} /> הדפס / שמור כ-PDF
            </button>
            <button
              onClick={() => setPocketSummaryScope(null)}
              className="px-4 py-2.5 border border-slate-300 hover:bg-slate-100 rounded-xl text-sm font-semibold"
            >
              חזרה ללמידה
            </button>
          </div>
        </div>

        <div className="py-6 space-y-6">
          <div className="border-b border-slate-300 pb-4">
            <span className="text-xs font-bold uppercase text-blue-700">MedStudy AI — דף עזר קליני מרוכז</span>
            <h1 className="text-3xl font-extrabold mt-1">{activeCourse.title}</h1>
            <p className="text-xs text-slate-500 mt-1">
              {userName.trim() ? `הופק עבור: ${userName.trim()} • ` : ''}
              תאריך הפקה: {new Date().toLocaleDateString('he-IL')}
            </p>
          </div>

          {sessionsToPrint.length === 0 ? (
            <p className="text-sm text-slate-600">
              טרם נפתחו שיעורים בקורס זה. היכנס לפחות לסשן אחד כדי להפיק לו סיכום כיס.
            </p>
          ) : (
            sessionsToPrint.map((sess: any) => (
              <div key={sess.id} className="space-y-4 pb-6 border-b border-slate-300 break-inside-avoid">
                <h2 className="text-xl font-bold text-blue-800 bg-blue-50 px-3 py-1.5 rounded-lg">
                  שלב #{sess.id}: {sess.topic}
                </h2>

                <div className="space-y-3">
                  {sess.savedContent?.blocks?.map((b: any, idx: number) => (
                    <div key={idx} className="pr-3 border-r-2 border-blue-600 space-y-1">
                      <h3 className="font-bold text-sm">
                        {idx + 1}. {b.title}
                      </h3>
                      <p className="text-xs leading-relaxed text-slate-700">{b.explanation}</p>
                    </div>
                  ))}
                </div>

                {sess.savedContent?.comparisonTable?.length > 0 && (
                  <div className="pt-2">
                    <h4 className="text-xs font-bold mb-1.5 text-slate-700">טבלת השוואה קלינית:</h4>
                    <table className="w-full text-xs text-right border border-slate-300 border-collapse">
                      <thead className="bg-slate-100">
                        <tr>
                          <th className="p-2 border border-slate-300">פרמטר</th>
                          <th className="p-2 border border-slate-300">ממצא א׳</th>
                          <th className="p-2 border border-slate-300">ממצא ב׳</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sess.savedContent.comparisonTable.map((r: any, rIdx: number) => (
                          <tr key={rIdx}>
                            <td className="p-2 border border-slate-300 font-semibold">{r.param}</td>
                            <td className="p-2 border border-slate-300">{r.acute}</td>
                            <td className="p-2 border border-slate-300">{r.chronic}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))
          )}

          <div className="text-center text-[11px] text-slate-400 pt-4">
            © {new Date().getFullYear()} כל הזכויות שמורות למתן פלדמן
          </div>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className={darkMode ? 'dark bg-slate-950 text-slate-100 min-h-screen flex flex-col' : 'bg-slate-50 text-slate-900 min-h-screen flex flex-col'}>
      <header className="border-b border-slate-200 dark:border-slate-800 px-6 py-4 flex justify-between items-center sticky top-0 backdrop-blur-md bg-white/90 dark:bg-slate-950/90 z-20">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setStep(courses.length > 0 ? 0 : 1)}>
          <div className="bg-blue-600 p-2 rounded-xl text-white">
            <BookOpen size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">MedStudy AI - Nursing</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {userName.trim() ? `סביבת הלמידה של ${userName.trim()}` : 'מערכת הוראה קלינית אינטראקטיבית'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {courses.length > 0 && step !== 0 && (
            <button
              onClick={() => setStep(0)}
              className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-sm font-medium flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-900 transition"
            >
              <FolderOpen size={16} className="text-blue-500" />
              <span>הקורסים שלי ({courses.length})</span>
            </button>
          )}
          {step === 3 && (
            <button
              onClick={() => {
                stopSpeech();
                setStep(2);
              }}
              className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-sm font-medium flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-900 transition"
            >
              <ArrowRight size={16} />
              חזרה ללו"ז
            </button>
          )}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition ${
              apiKey ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' : 'border-amber-500/40 bg-amber-500/10 text-amber-500'
            }`}
          >
            <Settings size={16} />
            <span className="hidden sm:inline">{apiKey ? 'הגדרות ו-AI' : 'חבר מפתח AI'}</span>
          </button>
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-900 transition"
            title={darkMode ? 'עבור למצב יום' : 'עבור למצב לילה'}
          >
            {darkMode ? <Sun size={20} className="text-amber-400" /> : <Moon size={20} className="text-slate-600" />}
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="bg-slate-900 text-white border-b border-slate-800 px-6 py-4">
          <div className="max-w-5xl mx-auto flex flex-col lg:flex-row items-center justify-between gap-4">
            <div className="text-sm">
              <p className="font-bold flex items-center gap-1.5 text-blue-400">
                <Key size={16} /> הגדרות אישיות וחיבור מנוע Google Gemini AI
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                השם ומפתח ה-API נשמרים בדפדפן שלך בלבד. כל תוכן במערכת עובר ביקורת איכות כפולה אוטומטית.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row w-full lg:w-auto gap-2.5">
              <div className="relative flex items-center">
                <User size={15} className="text-slate-400 absolute right-3 pointer-events-none" />
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => saveUserName(e.target.value)}
                  placeholder="השם הפרטי שלך..."
                  className="w-full sm:w-44 bg-slate-800 border border-slate-700 rounded-xl pr-9 pl-3 py-2 text-sm outline-none focus:border-blue-500 text-white"
                />
              </div>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => saveApiKey(e.target.value)}
                placeholder="הדבק מפתח API (מתחיל ב-AIza...)"
                className="flex-1 sm:w-64 bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2 text-sm outline-none focus:border-blue-500 text-white"
              />
              <button
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl text-sm font-semibold text-white shrink-0"
              >
                שמור וסגור
              </button>
            </div>
          </div>
        </div>
      )}

      {/* מודאל מרתון תיקון טעויות */}
      {showMistakesModal && activeCourse && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-40 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl">
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
              <div className="flex items-center gap-2.5">
                <div className="bg-rose-500/10 text-rose-500 p-2 rounded-xl">
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-lg">בנק טעויות ומרתון חיזוק — {activeCourse.title}</h3>
                  <p className="text-xs text-slate-400">
                    {courseMistakes.length} שאלות שזוהו כנקודות תורפה לאורך הקורס
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowMistakesModal(false);
                  setMarathonQuestions(null);
                }}
                className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5 flex-1">
              {!marathonQuestions ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3 bg-rose-500/5 border border-rose-500/20 p-4 rounded-xl">
                    <p className="text-xs text-slate-600 dark:text-slate-300 max-w-md">
                      המערכת אספה אוטומטית כל שאלה שטעית בה בשיעורים, בבחנים וב-Code Blue. צור מרתון ממוקד כדי לתקן אותן לפני הבחינה!
                    </p>
                    <button
                      onClick={handleStartMistakesMarathon}
                      disabled={isGeneratingMarathon || courseMistakes.length === 0}
                      className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm"
                    >
                      {isGeneratingMarathon ? <Loader2 size={15} className="animate-spin" /> : <Target size={15} />}
                      <span>{isGeneratingMarathon ? 'בונה ומשייף מרתון...' : 'בנה מרתון תיקון טעויות'}</span>
                    </button>
                  </div>

                  <div className="space-y-3">
                    {courseMistakes.map((m: any) => (
                      <div
                        key={m.id}
                        className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 space-y-1.5 text-xs"
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-blue-500">
                            {m.source} • {m.sessionTopic}
                          </span>
                          <button
                            onClick={() => removeMistakeFromBank(m.id)}
                            className="text-emerald-500 hover:underline font-semibold"
                          >
                            סמן כתוקן ✓
                          </button>
                        </div>
                        <p className="font-semibold text-sm text-slate-800 dark:text-slate-200">{m.question}</p>
                        <p className="text-red-500">טעות קודמת: {m.userAnswer}</p>
                        <p className="text-emerald-500 font-medium">תשובה נכונה: {m.correctAnswer}</p>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="space-y-5">
                  <div className="flex justify-between items-center">
                    <h4 className="font-bold text-base text-rose-500">
                      מרתון תיקון טעויות ({marathonQuestions.length} שאלות מותאמות)
                    </h4>
                    <button
                      onClick={() => setMarathonQuestions(null)}
                      className="text-xs underline text-slate-400"
                    >
                      חזרה לרשימת הטעויות
                    </button>
                  </div>

                  {marathonQuestions.map((item: any, qIdx: number) => (
                    <div key={qIdx} className="space-y-2.5 pb-4 border-b border-slate-200 dark:border-slate-800">
                      <p className="font-semibold text-sm">
                        {qIdx + 1}. {item.q}
                      </p>
                      <div className="space-y-1.5">
                        {item.opts.map((opt: string, oIdx: number) => {
                          const chosen = marathonAnswers[qIdx] === oIdx;
                          const isCorrect = item.ans === oIdx;
                          let style = 'border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800';
                          if (marathonSubmitted) {
                            if (isCorrect) style = 'bg-emerald-500/15 border-emerald-500 text-emerald-500 font-semibold';
                            else if (chosen) style = 'bg-red-500/15 border-red-500 text-red-500';
                          } else if (chosen) {
                            style = 'border-blue-500 bg-blue-500/10 text-blue-500';
                          }
                          return (
                            <button
                              key={oIdx}
                              disabled={marathonSubmitted}
                              onClick={() => setMarathonAnswers({ ...marathonAnswers, [qIdx]: oIdx })}
                              className={`w-full text-right p-3 rounded-xl border text-xs transition ${style}`}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                      {marathonSubmitted && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 p-3 rounded-xl">
                          <strong>הסבר:</strong> {item.explanation}
                        </p>
                      )}
                    </div>
                  ))}

                  {!marathonSubmitted ? (
                    <button
                      onClick={() => setMarathonSubmitted(true)}
                      className="w-full py-3 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-sm"
                    >
                      בדוק תוצאות מרתון
                    </button>
                  ) : (
                    <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex justify-between items-center text-sm font-bold text-emerald-500">
                      <span>
                        ציון במרתון: {marathonQuestions.filter((q: any, i: number) => marathonAnswers[i] === q.ans).length} / {marathonQuestions.length}
                      </span>
                      <button
                        onClick={handleStartMistakesMarathon}
                        className="text-xs underline flex items-center gap-1"
                      >
                        <RotateCcw size={13} /> צור סט מרתון נוסף
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <main className="max-w-6xl mx-auto p-6 flex-1 w-full">
        {step === 0 && (
          <div className="space-y-6 mt-4">
            <div className="flex flex-wrap justify-between items-center gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <div>
                <h2 className="text-2xl font-bold">
                  {userName.trim() ? `הקורסים של ${userName.trim()}` : 'הקורסים שלי בסיעוד'}
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-0.5">
                  <ShieldCheck size={15} className="text-emerald-500" />
                  אחסון מורחב פעיל (IndexedDB) — כולל מעקב מוכנות לבחינה, טעויות וחזרות מרווחות
                </p>
              </div>
              <button
                onClick={openNewCourseForm}
                className="px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center gap-2 shadow-lg shadow-blue-600/20 transition"
              >
                <Plus size={18} />
                הוסף קורס חדש
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {courses.map((course) => {
                const analytics = getCourseAnalytics(course);

                return (
                  <div
                    key={course.id}
                    onClick={() => {
                      setActiveCourseId(course.id);
                      setCourseSearchQuery('');
                      setStep(2);
                    }}
                    className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-blue-500 transition cursor-pointer flex flex-col justify-between space-y-5 group shadow-sm"
                  >
                    <div className="space-y-2">
                      <div className="flex justify-between items-start gap-2">
                        <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-500">
                          דדליין: {new Date(course.deadline).toLocaleDateString('he-IL')}
                        </span>
                        <button
                          onClick={(e) => deleteCourse(course.id, e)}
                          className="text-slate-400 hover:text-red-500 p-1 rounded-lg transition"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <h3 className="text-lg font-bold group-hover:text-blue-500 transition">{course.title}</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {course.filesCount} קבצים • {analytics?.totalSessions} סשנים של {course.sessionDuration} דק׳
                      </p>
                      {(course.mistakesBank?.length > 0 || course.reviewCardsBank?.length > 0) && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {course.mistakesBank?.length > 0 && (
                            <span className="text-[11px] px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-500 font-semibold">
                              {course.mistakesBank.length} טעויות לחיזוק
                            </span>
                          )}
                          {course.reviewCardsBank?.length > 0 && (
                            <span className="text-[11px] px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-500 font-semibold">
                              {course.reviewCardsBank.length} כרטיסיות לחזרה
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between text-xs font-semibold">
                        <span className="text-slate-400">מוכנות לבחינה</span>
                        <span
                          className={
                            (analytics?.readinessScore || 0) >= 80
                              ? 'text-emerald-500'
                              : (analytics?.readinessScore || 0) >= 50
                              ? 'text-blue-500'
                              : 'text-amber-500'
                          }
                        >
                          {analytics?.readinessScore || 0}% ({analytics?.completedSessions}/{analytics?.totalSessions} סשנים)
                        </span>
                      </div>
                      <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            (analytics?.readinessScore || 0) >= 80 ? 'bg-emerald-500' : 'bg-blue-600'
                          }`}
                          style={{ width: `${analytics?.readinessScore || 0}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-4">
            <div className="lg:col-span-6 space-y-6">
              <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
                  <Upload size={20} className="text-blue-500" />
                  {isAddingMaterialMode ? `הוספת חומרי לימוד ל-${courseName}` : '1. העלאת חומרי לימוד לקורס'}
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                  {isAddingMaterialMode
                    ? 'הסשנים שכבר השלמת יישמרו. החומר החדש והסשנים שטרם נלמדו יסודרו מחדש על הימים שנותרו עד המבחן.'
                    : 'המערכת מזהה יחידות נושאיות שלמות מתוך הקבצים ומסדרת אותן מהיסודות אל ההתערבות הקלינית.'}
                </p>

                <label className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition bg-slate-50/50 dark:bg-slate-950/50">
                  {isParsingFiles ? (
                    <Loader2 size={32} className="text-blue-500 mb-3 animate-spin" />
                  ) : (
                    <Upload size={32} className="text-blue-500 mb-3" />
                  )}
                  <span className="font-medium text-sm">
                    {isParsingFiles ? 'מחלץ טקסט מלא מהקבצים...' : 'לחץ לבחירת קבצים או גרור לכאן'}
                  </span>
                  <span className="text-xs text-slate-400 mt-1">PDF, Word, מצגות PowerPoint וטקסט</span>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.pptx,.ppt,.docx,.doc,.txt"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>

                {files.length > 0 && (
                  <div className="mt-5 space-y-2.5">
                    <h3 className="text-xs font-semibold uppercase text-slate-400">
                      קבצים שנקראו ({files.length} • {files.reduce((a, b) => a + b.wordCount, 0).toLocaleString()} מילים)
                    </h3>
                    {files.map((file) => (
                      <div key={file.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <FileText size={18} className="text-blue-500 shrink-0" />
                          <div className="truncate">
                            <p className="text-sm font-medium truncate">{file.name}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{file.type} • {file.wordCount.toLocaleString()} מילים</p>
                          </div>
                        </div>
                        <button onClick={() => removeFile(file.id)} className="text-slate-400 hover:text-red-500 p-1">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="lg:col-span-6 space-y-6">
              <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
                <div>
                  <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
                    <Calendar size={20} className="text-blue-500" />
                    2. הגדרות זמן ותעדוף מבחן
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    אורך הסשן קובע אוטומטית את עומק ההסבר, מספר שלבי ההוראה וסינון החומר למבחן
                  </p>
                </div>

                {!isAddingMaterialMode && (
                  <div>
                    <label className="block text-sm font-medium mb-2">שם הקורס</label>
                    <input
                      type="text"
                      value={courseName}
                      onChange={(e) => setCourseName(e.target.value)}
                      placeholder="למשל: פרמקולוגיה / קרדיולוגיה / מיקרוביולוגיה..."
                      className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium mb-2">תאריך יעד לבחינה</label>
                  <input
                    type="date"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    ימי לימוד בשבוע ({selectedDays.length} פעמים בשבוע)
                  </label>
                  <div className="grid grid-cols-7 gap-2">
                    {DAYS_OF_WEEK.map((day) => {
                      const isSelected = selectedDays.includes(day.id);
                      return (
                        <button
                          key={day.id}
                          onClick={() => toggleDay(day.id)}
                          className={`py-2.5 rounded-xl text-sm font-semibold transition border ${
                            isSelected
                              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                              : 'border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2 flex items-center justify-between">
                    <span>משך כל סשן (משפיע על היקף התוכן וסינון המבחן)</span>
                    <span className="text-blue-500 font-bold">{sessionDuration} דקות</span>
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { mins: 30, desc: '3 שלבים • High-Yield' },
                      { mins: 45, desc: '4 שלבים • ממוקד' },
                      { mins: 60, desc: '5 שלבים • מלא' },
                      { mins: 90, desc: '7 שלבים • מעמיק' },
                    ].map((opt) => (
                      <button
                        key={opt.mins}
                        onClick={() => setSessionDuration(opt.mins)}
                        className={`p-2 rounded-xl text-center border transition ${
                          sessionDuration === opt.mins
                            ? 'bg-blue-600/10 border-blue-500 text-blue-500'
                            : 'border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <div className="text-sm font-bold">{opt.mins} דק׳</div>
                        <div className="text-[10px] opacity-80 mt-0.5">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={generateAIDraftPlan}
                  disabled={isPlanningAI}
                  className="w-full py-3.5 px-6 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold rounded-xl shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2 transition"
                >
                  {isPlanningAI ? (
                    <>
                      <Loader2 size={20} className="animate-spin" />
                      <span>מסדר ומשייף את תוכנית הלימודים (בקרת איכות כפולה)...</span>
                    </>
                  ) : (
                    <>
                      <Brain size={20} />
                      <span>{isAddingMaterialMode ? 'בנה לו"ז מעודכן ליתרת הזמן' : 'בנה תוכנית למידה מדורגת'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 1.5 && draftPlan && (
          <div className="space-y-6 mt-4 max-w-4xl mx-auto">
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border-2 border-blue-500/40 space-y-4 shadow-sm">
              <div className="flex flex-wrap justify-between items-start gap-4">
                <div>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-500 flex items-center gap-1.5 w-fit">
                    <Brain size={14} /> סדר למידה פדגוגי מאומת
                  </span>
                  <h2 className="text-2xl font-bold mt-2">
                    {isAddingMaterialMode ? 'תוכנית מעודכנת ליתרת הימים' : 'סדר הלמידה לקורס'}
                  </h2>
                </div>
                <button
                  onClick={() => setStep(1)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  חזרה לעריכת קבצים
                </button>
              </div>

              {draftPlan.preservedCompleted?.length > 0 && (
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  ✓ נשמרו {draftPlan.preservedCompleted.length} סשנים שכבר השלמת בעבר. להלן הפריסה החדשה של החומר שנותר + הקבצים החדשים:
                </div>
              )}

              <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/20 text-sm text-slate-700 dark:text-slate-300">
                <strong className="text-blue-500 block mb-1">אסטרטגיית למידה:</strong>
                {draftPlan.strategy}
              </div>

              <div className="space-y-3">
                {draftPlan.sessions.map((item: any, idx: number) => (
                  <div
                    key={idx}
                    className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4"
                  >
                    <div className="flex items-start gap-3 flex-1">
                      <span className="bg-blue-600 text-white font-bold text-xs w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-1">
                        {idx + 1}
                      </span>
                      <div className="space-y-1.5 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                          <span className="font-semibold text-blue-500">
                            {draftPlan.dates[idx]?.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'short' })}
                          </span>
                          <span>•</span>
                          <span>מקור: {item.fileName}</span>
                          <span>•</span>
                          <span>{item.charCount?.toLocaleString()} תווים</span>
                        </div>
                        <input
                          type="text"
                          value={item.title}
                          onChange={(e) => updateDraftSessionTitle(idx, e.target.value)}
                          className="w-full font-bold text-sm bg-transparent border-b border-transparent focus:border-blue-500 outline-none py-0.5"
                        />
                        <p className="text-xs text-emerald-500 flex items-center gap-1">
                          <Sparkles size={12} /> {item.rationale}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1 shrink-0">
                      <button
                        onClick={() => moveDraftSession(idx, -1)}
                        disabled={idx === 0}
                        className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-30"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        onClick={() => moveDraftSession(idx, 1)}
                        disabled={idx === draftPlan.sessions.length - 1}
                        className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-30"
                      >
                        <ArrowDown size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={confirmAndSaveCourse}
                className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 transition text-base"
              >
                <Check size={20} />
                אשר ושמור לוח זמנים ({draftPlan.sessions.length} סשנים)
              </button>
            </div>
          </div>
        )}

        {step === 2 && activeCourse && (
          <div className="space-y-6 mt-4">
            <div className="flex flex-wrap justify-between items-center gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <div className="space-y-1 max-w-2xl">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold px-2.5 py-0.5 rounded-md bg-blue-500/10 text-blue-500">קורס פעיל</span>
                  <h2 className="text-xl font-bold">{activeCourse.title}</h2>
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  דדליין לבחינה: {new Date(activeCourse.deadline).toLocaleDateString('he-IL')} • {activeCourse.filesCount} קבצים
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {courseMistakes.length > 0 && (
                  <button
                    onClick={() => setShowMistakesModal(true)}
                    className="px-3.5 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-500 hover:bg-rose-500/20 text-xs sm:text-sm font-bold flex items-center gap-1.5 transition"
                  >
                    <AlertTriangle size={16} />
                    מרתון טעויות ({courseMistakes.length})
                  </button>
                )}
                <button
                  onClick={() => setPocketSummaryScope('course')}
                  className="px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition"
                >
                  <Printer size={16} />
                  סיכום כיס לקורס
                </button>
                <button
                  onClick={openAddMaterialToCourse}
                  className="px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition"
                >
                  <FilePlus2 size={16} />
                  הוסף חומר
                </button>
                <button
                  onClick={exportToCalendarTasks}
                  className="px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-medium flex items-center gap-1.5 shadow-sm transition"
                >
                  <Download size={16} />
                  ייצא ליומן (.ics)
                </button>
              </div>
            </div>

            {courseAnalytics && (
              <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold flex items-center gap-2 text-slate-800 dark:text-slate-100">
                    <BarChart3 size={18} className="text-blue-500" />
                    מד מוכנות לבחינה ואנליטיקה קלינית
                  </h3>
                  {courseAnalytics.weakestSession && (
                    <span className="text-xs px-3 py-1 rounded-full bg-rose-500/10 text-rose-500 font-semibold">
                      מוקד לחיזוק: "{courseAnalytics.weakestSession.topic}" ({courseAnalytics.weakestSession.mistakesCount} טעויות)
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <p className="text-xs text-slate-400">ציון מוכנות משוקלל</p>
                    <p
                      className={`text-2xl font-extrabold mt-1 ${
                        courseAnalytics.readinessScore >= 80
                          ? 'text-emerald-500'
                          : courseAnalytics.readinessScore >= 50
                          ? 'text-blue-500'
                          : 'text-amber-500'
                      }`}
                    >
                      {courseAnalytics.readinessScore}%
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <p className="text-xs text-slate-400">התקדמות בסילבוס</p>
                    <p className="text-2xl font-extrabold mt-1 text-slate-800 dark:text-slate-100">
                      {courseAnalytics.completedSessions}/{courseAnalytics.totalSessions}
                      <span className="text-xs font-normal text-slate-400 mr-1">({courseAnalytics.completionPct}%)</span>
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <p className="text-xs text-slate-400">ממוצע בחנים / Code Blue</p>
                    <p className="text-2xl font-extrabold mt-1 text-blue-500">
                      {courseAnalytics.avgQuiz !== null ? `${courseAnalytics.avgQuiz}%` : '—'}
                      {courseAnalytics.avgCodeBlue !== null && (
                        <span className="text-xs font-semibold text-rose-500 mr-2">
                          (CB: {courseAnalytics.avgCodeBlue}%)
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <p className="text-xs text-slate-400">טעויות פתוחות לתיקון</p>
                    <p className={`text-2xl font-extrabold mt-1 ${courseAnalytics.openMistakes > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                      {courseAnalytics.openMistakes}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
              <div className="relative flex items-center">
                <Search size={18} className="text-slate-400 absolute right-3.5 pointer-events-none" />
                <input
                  type="text"
                  value={courseSearchQuery}
                  onChange={(e) => setCourseSearchQuery(e.target.value)}
                  placeholder="חיפוש מהיר בכל הקורס (לדוגמה: דיגוקסין, היפרקלמיה, בצקת ריאות, מינון...)"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pr-10 pl-10 py-2.5 text-sm outline-none focus:border-blue-500"
                />
                {courseSearchQuery && (
                  <button
                    onClick={() => setCourseSearchQuery('')}
                    className="absolute left-3 text-slate-400 hover:text-slate-600"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              {courseSearchQuery.trim().length >= 2 && (
                <div className="space-y-2 pt-1">
                  <p className="text-xs font-semibold text-slate-400">
                    נמצאו {searchResults.length} התאמות עבור "{courseSearchQuery}":
                  </p>
                  {searchResults.length === 0 ? (
                    <p className="text-xs text-slate-500 py-2">לא נמצאו תוצאות תואמות בחומרי הקורס.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-60 overflow-y-auto">
                      {searchResults.map((res, rIdx) => (
                        <button
                          key={rIdx}
                          onClick={() => startSession(res.session)}
                          className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 hover:border-blue-500 text-right space-y-1 transition"
                        >
                          <div className="flex justify-between items-center text-[11px] font-bold text-blue-500">
                            <span>
                              שלב #{res.session.id}: {res.session.topic}
                            </span>
                            <span>קפוץ לשיעור ←</span>
                          </div>
                          <p className="text-[11px] font-semibold text-emerald-500">{res.matchSource}</p>
                          <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2">{res.snippet}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeCourse.schedule.map((session: any) => (
                <div
                  key={session.id}
                  className={`bg-white dark:bg-slate-900 p-5 rounded-2xl border transition flex items-center justify-between gap-3 shadow-sm ${
                    session.completed ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-slate-200 dark:border-slate-800 hover:border-blue-500/50'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs font-medium text-blue-500">
                      <span>שלב #{session.id}</span>
                      <span>•</span>
                      <span>{session.date}</span>
                      {session.completed && (
                        <span className="text-emerald-500 flex items-center gap-1 font-bold">
                          <CheckCircle2 size={14} /> הושלם
                        </span>
                      )}
                    </div>
                    <h3 className="font-semibold text-base">{session.topic}</h3>
                    {session.rationale && (
                      <p className="text-xs text-slate-400 dark:text-slate-500">{session.rationale}</p>
                    )}
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 pt-0.5">
                      <Clock size={14} />
                      <span>{session.duration} דקות ({getDurationConfig(session.duration).blocksCount} שלבי הוראה)</span>
                    </div>
                  </div>

                  <button
                    onClick={() => startSession(session)}
                    className={`px-4 py-2.5 text-white text-sm font-medium rounded-xl flex items-center gap-1.5 transition shrink-0 ${
                      session.completed ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                  >
                    <span>{session.completed ? 'חזור על החומר' : 'התחל ללמוד'}</span>
                    <ArrowLeft size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 3 && activeSession && (
          isLoadingAI ? (
            <div className="flex flex-col items-center justify-center py-24 space-y-4">
              <Loader2 size={44} className="text-blue-500 animate-spin" />
              <h3 className="text-lg font-bold">המרצה הקליני בונה ומשייף שיעור אינטראקטיבי...</h3>
              <p className="text-sm text-slate-400">השיעור עובר ביקורת איכות קפדנית ל-{activeSession.duration} דקות עם שאלות בדיקה לכל שלב</p>
            </div>
          ) : studyContent && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-2">
              <div className="lg:col-span-7 space-y-5">
                <div className="grid grid-cols-4 gap-2 bg-white dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                  {[
                    { id: 'learn' as const, label: 'שיעור מודרך', icon: BookOpen, locked: false, status: 'ready' as const },
                    { id: 'flashcards' as const, label: 'כרטיסיות', icon: Layers, locked: !isLessonMastered, status: bgPrefetchStatus.flashcards },
                    { id: 'quiz' as const, label: 'בוחן מסכם', icon: Award, locked: !isLessonMastered, status: bgPrefetchStatus.quiz },
                    { id: 'game' as const, label: 'Code Blue', icon: Activity, locked: !isLessonMastered, status: bgPrefetchStatus.game },
                  ].map((tab) => {
                    const Icon = tab.icon;
                    const active = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        disabled={tab.locked}
                        onClick={() => handleTabSwitch(tab.id)}
                        title={tab.locked ? 'השלם את כל שלבי השיעור כדי לפתוח טאב זה' : ''}
                        className={`py-2 px-2.5 rounded-xl text-xs sm:text-sm font-semibold flex flex-col items-center justify-center gap-0.5 transition ${
                          tab.locked
                            ? 'opacity-50 cursor-not-allowed text-slate-400'
                            : active
                            ? tab.id === 'game' ? 'bg-rose-600 text-white shadow-sm' : 'bg-blue-600 text-white shadow-sm'
                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          {tab.locked ? <Lock size={13} /> : <Icon size={15} />}
                          <span>{tab.label}</span>
                        </div>
                        {tab.id !== 'learn' && (
                          <span className={`text-[10px] font-normal flex items-center gap-1 ${active ? 'text-white/85' : 'text-slate-400'}`}>
                            {tab.status === 'loading' ? (
                              <>
                                <Loader2 size={10} className="animate-spin" /> מכין ברקע...
                              </>
                            ) : tab.status === 'ready' ? (
                              <span className={active ? 'text-white' : 'text-emerald-500'}>מוכן ✓</span>
                            ) : null}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {showWarmupBanner && courseReviewCards.length > 0 && activeTab === 'learn' && (
                  <div className="bg-amber-500/10 border-2 border-amber-500/40 p-5 rounded-2xl space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                        <RefreshCw size={14} />
                        חימום זיכרון (Spaced Repetition) — {courseReviewCards.length} כרטיסיות לחזרה מהסשנים הקודמים
                      </span>
                      <button
                        onClick={() => setShowWarmupBanner(false)}
                        className="text-xs text-slate-400 hover:text-slate-600"
                      >
                        סגור חימום
                      </button>
                    </div>

                    {(() => {
                      const safeIdx = warmupCardIdx % courseReviewCards.length;
                      const currentSRCard = courseReviewCards[safeIdx];
                      return (
                        <div className="space-y-2.5">
                          <div
                            onClick={() => setWarmupFlipped(!warmupFlipped)}
                            className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-amber-500/30 cursor-pointer text-center space-y-1"
                          >
                            <span className="text-[10px] font-bold text-amber-500 uppercase">
                              {warmupFlipped ? 'הסבר קליני' : `מתוך: ${currentSRCard.sessionTopic} (לחץ להיפוך)`}
                            </span>
                            <p className="text-sm font-semibold">
                              {warmupFlipped ? currentSRCard.back : currentSRCard.front}
                            </p>
                          </div>

                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setWarmupFlipped(false);
                                setWarmupCardIdx((prev) => prev + 1);
                              }}
                              className="flex-1 py-2 rounded-xl border border-amber-500/40 text-amber-600 dark:text-amber-400 text-xs font-semibold"
                            >
                              עדיין מתלבט — השאר בחזרות
                            </button>
                            <button
                              onClick={() => {
                                removeCardFromSpacedRepetition(currentSRCard.front);
                                setWarmupFlipped(false);
                              }}
                              className="flex-1 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold"
                            >
                              זכרתי מצוין ✓ (הסר מתור החזרות)
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {!isLessonMastered && (
                  <div className="px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-2">
                    <Lock size={14} className="shrink-0" />
                    <span>
                      <strong>למידה מבוקרת (Mastery Gate):</strong> טאבי הכרטיסיות, הבוחן ו-Code Blue נטענים כעת ברקע וייפתחו מיד כשתשלים את כל {studyContent.blocks?.length} שלבי השיעור למטה.
                    </span>
                  </div>
                )}

                {activeTab === 'learn' && (
                  <div className="space-y-5">
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-wrap justify-between items-start gap-4">
                      <div>
                        <span className="text-xs font-semibold text-blue-500">
                          {activeCourse?.title} • שלב #{activeSession.id} • {activeSession.duration} דקות
                        </span>
                        <h2 className="text-2xl font-bold mt-1">{activeSession.topic}</h2>
                        <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                          <span>התקדמות בשיעור:</span>
                          <span className="font-bold text-blue-500">
                            {Math.min(unlockedBlockIdx + (isLessonMastered ? 1 : 0), studyContent.blocks?.length || 0)} / {studyContent.blocks?.length || 0} שלבים
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => {
                            const openBlocks = (studyContent.blocks || []).filter((_: any, i: number) => i <= unlockedBlockIdx);
                            const fullText = openBlocks
                              .map((b: any, i: number) => `סעיף ${i + 1}. ${b.title}. ${b.explanation}`)
                              .join('. ');
                            toggleSpeech('all-open', fullText);
                          }}
                          className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
                            speakingBlockKey === 'all-open'
                              ? 'bg-rose-600 text-white'
                              : 'bg-blue-500/10 text-blue-500 hover:bg-blue-500/20'
                          }`}
                        >
                          {speakingBlockKey === 'all-open' ? <Square size={14} /> : <Volume2 size={15} />}
                          <span>{speakingBlockKey === 'all-open' ? 'עצור הקראה' : 'האזן לשיעור בעברית'}</span>
                        </button>

                        <button
                          onClick={() => setPocketSummaryScope('session')}
                          className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold flex items-center gap-1.5 transition"
                        >
                          <Printer size={15} />
                          סיכום כיס (PDF)
                        </button>
                      </div>
                    </div>

                    {studyContent.blocks?.map((block: any, bIdx: number) => {
                      if (bIdx > unlockedBlockIdx) return null;

                      const chosenOpt = blockAnswers[bIdx];
                      const hasAnswered = chosenOpt !== undefined;
                      const isCorrect = chosenOpt === block.correctIndex;
                      const blockSpeechKey = `block-${bIdx}`;

                      return (
                        <div
                          key={bIdx}
                          className={`bg-white dark:bg-slate-900 p-6 rounded-2xl border-2 transition space-y-4 shadow-sm ${
                            isCorrect || isLessonMastered
                              ? 'border-emerald-500/40'
                              : 'border-blue-500/40'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="font-bold text-base text-blue-600 dark:text-blue-400 flex items-center gap-2">
                              <span className="bg-blue-600 text-white text-xs px-2 py-0.5 rounded-lg flex items-center justify-center shrink-0">
                                סעיף {bIdx + 1}
                              </span>
                              {block.title}
                            </h3>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() =>
                                  toggleSpeech(blockSpeechKey, `סעיף ${bIdx + 1}. ${block.title}. ${block.explanation}`)
                                }
                                className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                                  speakingBlockKey === blockSpeechKey
                                    ? 'bg-rose-600 text-white'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-blue-500/10 hover:text-blue-500'
                                }`}
                                title="הקרא סעיף זה בעברית"
                              >
                                {speakingBlockKey === blockSpeechKey ? <Square size={13} /> : <Volume2 size={14} />}
                                <span>{speakingBlockKey === blockSpeechKey ? 'עצור' : 'האזן'}</span>
                              </button>
                              {(isCorrect || isLessonMastered) && (
                                <span className="text-xs font-bold text-emerald-500 flex items-center gap-1">
                                  <CheckCircle2 size={15} /> הובן
                                </span>
                              )}
                            </div>
                          </div>

                          <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line">
                            {block.explanation}
                          </p>

                          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
                            <p className="text-sm font-bold flex items-center gap-1.5 text-slate-800 dark:text-slate-200">
                              <HelpCircle size={16} className="text-blue-500 shrink-0" />
                              {block.checkQuestion}
                            </p>

                            <div className="space-y-2">
                              {block.options.map((opt: string, oIdx: number) => {
                                const selected = chosenOpt === oIdx;
                                const right = oIdx === block.correctIndex;
                                let btnStyle = 'border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800';
                                if (selected) {
                                  btnStyle = right
                                    ? 'bg-emerald-500/15 border-emerald-500 text-emerald-600 dark:text-emerald-400 font-semibold'
                                    : 'bg-red-500/15 border-red-500 text-red-600 dark:text-red-400';
                                }
                                return (
                                  <button
                                    key={oIdx}
                                    onClick={() =>
                                      handleBlockOptionSelect(bIdx, oIdx, block.correctIndex, studyContent.blocks.length)
                                    }
                                    className={`w-full text-right p-3 rounded-xl border text-sm transition flex items-center justify-between ${btnStyle}`}
                                  >
                                    <span>{opt}</span>
                                    {selected && (right ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />)}
                                  </button>
                                );
                              })}
                            </div>

                            {hasAnswered && (
                              <div
                                className={`p-3.5 rounded-xl text-xs leading-relaxed ${
                                  isCorrect
                                    ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                                    : 'bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300'
                                }`}
                              >
                                <strong className="block mb-0.5">
                                  {isCorrect ? '✓ משוב המרצה הקליני:' : '✗ שים לב — נסה שוב:'}
                                </strong>
                                {block.feedbackByOption?.[chosenOpt]}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {isLessonMastered && (
                      <div className="bg-emerald-500/10 border-2 border-emerald-500/40 p-6 rounded-2xl space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <div>
                            <h3 className="font-bold text-lg text-emerald-600 dark:text-emerald-400">
                              כל שלבי השיעור הושלמו בהצלחה! 🎉
                            </h3>
                            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                              כעת נפתחו עבורך כרטיסיות השינון, הבוחן המסכם וסימולציית Code Blue.
                            </p>
                          </div>
                          <button
                            onClick={() => handleTabSwitch('flashcards')}
                            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold transition"
                          >
                            המשך לכרטיסיות שינון ←
                          </button>
                        </div>

                        {studyContent.comparisonTable?.length > 0 && (
                          <div className="overflow-x-auto pt-2">
                            <table className="w-full text-sm text-right border-collapse rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                              <thead className="bg-slate-100 dark:bg-slate-800 text-xs uppercase">
                                <tr>
                                  <th className="p-3">פרמטר</th>
                                  <th className="p-3 text-blue-500">ממצא א׳</th>
                                  <th className="p-3 text-amber-500">ממצא ב׳</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                                {studyContent.comparisonTable.map((row: any, i: number) => (
                                  <tr key={i}>
                                    <td className="p-3 font-medium">{row.param}</td>
                                    <td className="p-3 text-slate-600 dark:text-slate-300">{row.acute}</td>
                                    <td className="p-3 text-slate-600 dark:text-slate-300">{row.chronic}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'flashcards' && (
                  isLoadingTabContent || !studyContent.flashcards ? (
                    <div className="bg-white dark:bg-slate-900 p-12 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center space-y-3">
                      <Loader2 size={32} className="text-blue-500 animate-spin" />
                      <p className="text-sm font-semibold">מסיים להכין ולשייף כרטיסיות שינון...</p>
                    </div>
                  ) : (
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-6 shadow-sm">
                      <div className="flex justify-between items-center">
                        <h3 className="font-bold text-lg">
                          כרטיסיות שינון - {cardIndex + 1} / {studyContent.flashcards.length}
                        </h3>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={regenerateNewCards}
                            className="text-xs px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-500 font-semibold hover:bg-blue-500/20 flex items-center gap-1 transition"
                          >
                            <RotateCcw size={14} /> צור חדשות
                          </button>
                          <span className="text-xs bg-emerald-500/10 text-emerald-500 px-3 py-1 rounded-full font-semibold">
                            נשלטות: {knownCards.length}/{studyContent.flashcards.length}
                          </span>
                        </div>
                      </div>

                      <div
                        onClick={() => setIsFlipped(!isFlipped)}
                        className="min-h-[260px] rounded-2xl border-2 border-blue-500/30 bg-slate-50 dark:bg-slate-950 p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:border-blue-500 transition select-none shadow-inner"
                      >
                        <span className="text-xs uppercase tracking-wider text-blue-500 font-bold mb-3">
                          {isFlipped ? 'הסבר קליני' : 'מושג / שאלה (לחץ להיפוך)'}
                        </span>
                        <p className="text-lg font-semibold leading-relaxed">
                          {isFlipped ? studyContent.flashcards[cardIndex]?.back : studyContent.flashcards[cardIndex]?.front}
                        </p>
                      </div>

                      <div className="flex justify-between items-center gap-3">
                        <button
                          onClick={() => {
                            const currentCard = studyContent.flashcards[cardIndex];
                            if (currentCard) {
                              addCardToSpacedRepetition(currentCard, activeSession.topic);
                            }
                            setIsFlipped(false);
                            setCardIndex((prev) => (prev + 1) % studyContent.flashcards.length);
                          }}
                          className="flex-1 py-3 rounded-xl border border-amber-500/40 text-amber-500 font-semibold text-sm hover:bg-amber-500/10 transition"
                        >
                          צריך לחזור שוב (יוצג בסשן הבא)
                        </button>
                        <button
                          onClick={() => {
                            const currentCard = studyContent.flashcards[cardIndex];
                            const currentId = currentCard?.id || cardIndex;
                            if (!knownCards.includes(currentId)) setKnownCards([...knownCards, currentId]);
                            if (currentCard) {
                              removeCardFromSpacedRepetition(currentCard.front);
                            }
                            setIsFlipped(false);
                            setCardIndex((prev) => (prev + 1) % studyContent.flashcards.length);
                          }}
                          className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm transition"
                        >
                          יודע היטב ✓
                        </button>
                      </div>
                    </div>
                  )
                )}

                {activeTab === 'quiz' && (
                  isLoadingTabContent || !currentQuizAttempt ? (
                    <div className="bg-white dark:bg-slate-900 p-12 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center space-y-3">
                      <Loader2 size={32} className="text-blue-500 animate-spin" />
                      <p className="text-sm font-semibold">מסיים לבנות ולשייף שאלות בחינה קליניות...</p>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-6 shadow-sm">
                        <div className="flex flex-wrap justify-between items-center gap-2">
                          <div>
                            <h3 className="font-bold text-lg">
                              בוחן אמריקאי #{(studyContent.quizAttempts?.length || 1) - activeQuizAttemptIdx} ({currentQuizAttempt.questions.length} שאלות)
                            </h3>
                            <p className="text-xs text-slate-400">נוצר בשעה {currentQuizAttempt.createdAt}</p>
                          </div>
                          <button
                            onClick={createAndAppendQuizAttempt}
                            className="text-xs px-3.5 py-2 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 flex items-center gap-1.5 transition shadow-sm"
                          >
                            <Plus size={14} /> צור בוחן חדש
                          </button>
                        </div>

                        {currentQuizAttempt.questions.map((item: any, qIdx: number) => (
                          <div key={qIdx} className="space-y-3 pb-5 border-b border-slate-200 dark:border-slate-800 last:border-0">
                            <p className="font-semibold text-sm">{qIdx + 1}. {item.q}</p>
                            <div className="space-y-1.5">
                              {item.opts.map((opt: string, oIdx: number) => {
                                const chosen = quizAnswers[qIdx] === oIdx;
                                const isCorrect = item.ans === oIdx;
                                let style = 'border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800';
                                if (quizSubmitted) {
                                  if (isCorrect) style = 'bg-emerald-500/15 border-emerald-500 text-emerald-500 font-semibold';
                                  else if (chosen) style = 'bg-red-500/15 border-red-500 text-red-500';
                                } else if (chosen) {
                                  style = 'border-blue-500 bg-blue-500/10 text-blue-500';
                                }
                                return (
                                  <button
                                    key={oIdx}
                                    disabled={quizSubmitted}
                                    onClick={() => setQuizAnswers({ ...quizAnswers, [qIdx]: oIdx })}
                                    className={`w-full text-right p-3 rounded-xl border text-sm transition ${style}`}
                                  >
                                    {opt}
                                  </button>
                                );
                              })}
                            </div>

                            {quizSubmitted && (
                              <div
                                className={`p-3.5 rounded-xl text-xs space-y-1 mt-2 ${
                                  quizAnswers[qIdx] === item.ans
                                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                                    : 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/30'
                                }`}
                              >
                                <p className="font-bold">
                                  {quizAnswers[qIdx] === item.ans ? '✓ תשובה נכונה!' : '✗ טעות בתשובה.'}
                                </p>
                                <p className="leading-relaxed">
                                  <strong className="font-semibold">הסבר קליני:</strong> {item.explanation}
                                </p>
                              </div>
                            )}
                          </div>
                        ))}

                        {!quizSubmitted ? (
                          <button
                            onClick={handleSubmitQuiz}
                            className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition shadow-lg shadow-blue-600/20"
                          >
                            הגש בוחן וקבל משוב מלא
                          </button>
                        ) : (
                          <div className="space-y-4">
                            <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30 flex justify-between items-center">
                              <span className="font-bold text-blue-500">
                                ציון: {currentQuizAttempt.questions.filter((q: any, i: number) => quizAnswers[i] === q.ans).length} מתוך {currentQuizAttempt.questions.length}
                              </span>
                              <button
                                onClick={() => {
                                  setQuizAnswers({});
                                  setQuizSubmitted(false);
                                  setQuizWeaknessFeedback('');
                                }}
                                className="text-xs underline flex items-center gap-1 font-semibold"
                              >
                                <RotateCcw size={14} /> פתור שוב בוחן זה
                              </button>
                            </div>

                            {isAnalyzingQuiz ? (
                              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                                <Loader2 size={16} className="animate-spin shrink-0" />
                                <span>מנתח את הטעויות שלך ומאתר סעיפים מומלצים לחזרה...</span>
                              </div>
                            ) : quizWeaknessFeedback && (
                              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/40 space-y-1.5">
                                <h4 className="text-xs font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                                  <Target size={15} /> המלצות חזרה אישיות על בסיס הטעויות שלך:
                                </h4>
                                <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-200 whitespace-pre-line">
                                  {quizWeaknessFeedback}
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {studyContent.quizAttempts?.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3 shadow-sm">
                          <h4 className="text-sm font-bold flex items-center gap-2 text-slate-700 dark:text-slate-200">
                            <History size={16} className="text-blue-500" />
                            היסטוריית בחנים בסשן זה ({studyContent.quizAttempts.length})
                          </h4>
                          <div className="space-y-2">
                            {studyContent.quizAttempts.map((att: any, idx: number) => {
                              const num = studyContent.quizAttempts.length - idx;
                              const isSelected = idx === activeQuizAttemptIdx;
                              return (
                                <button
                                  key={att.id}
                                  onClick={() => loadQuizAttemptState(att, idx)}
                                  className={`w-full p-3 rounded-xl border text-right flex items-center justify-between text-xs transition ${
                                    isSelected
                                      ? 'border-blue-500 bg-blue-500/10 font-semibold'
                                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-blue-500">בוחן #{num}</span>
                                    <span className="text-slate-400">• {att.createdAt}</span>
                                  </div>
                                  <span
                                    className={`px-2.5 py-0.5 rounded-full font-bold ${
                                      att.submitted
                                        ? 'bg-emerald-500/15 text-emerald-500'
                                        : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                                    }`}
                                  >
                                    {att.submitted ? `ציון: ${att.score}` : 'טרם הוגש'}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                )}

                {activeTab === 'game' && (
                  isLoadingTabContent || !currentCodeBlueAttempt ? (
                    <div className="bg-white dark:bg-slate-900 p-12 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center space-y-3">
                      <Loader2 size={32} className="text-rose-500 animate-spin" />
                      <p className="text-sm font-semibold">מסיים להכין ולשייף תרחישי חירום קליניים...</p>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border-2 border-rose-500/40 space-y-6 shadow-sm">
                        <div className="flex flex-wrap justify-between items-center gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
                          <div>
                            <span className="text-xs font-bold text-rose-500">
                              סימולציית Code Blue #{(studyContent.codeBlueAttempts?.length || 1) - activeCodeBlueAttemptIdx}
                            </span>
                            <p className="text-[11px] text-slate-400">נוצר בשעה {currentCodeBlueAttempt.createdAt}</p>
                          </div>
                          <button
                            onClick={createAndAppendCodeBlueAttempt}
                            className="text-xs px-3.5 py-2 rounded-xl bg-rose-600 text-white font-semibold hover:bg-rose-700 flex items-center gap-1.5 transition shadow-sm"
                          >
                            <Plus size={14} /> צור Code Blue חדש
                          </button>
                        </div>

                        {!gameStarted ? (
                          <div className="text-center py-6 space-y-4">
                            <div className="bg-rose-500/10 text-rose-500 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto">
                              <HeartPulse size={36} />
                            </div>
                            <h3 className="text-2xl font-bold">Code Blue: סימולציית מיון ומחלקה</h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                              קבלת החלטות סיעודיות תחת לחץ זמן על בסיס חומר הלימוד של הפרק!
                            </p>
                            <button
                              onClick={startCodeBlueGame}
                              className="px-8 py-3.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-lg shadow-rose-600/20 transition"
                            >
                              התחל תרחיש קליני 🚑
                            </button>
                          </div>
                        ) : gameOver ? (
                          <div className="space-y-5 py-2">
                            <div className="text-center space-y-3">
                              <h3 className="text-2xl font-bold">
                                {patientStability > 0 ? 'המטופל יוצב בהצלחה במחלקה! 🎉' : 'המטופל פיתח הידרדרות קלינית ⚠️'}
                              </h3>
                              <p className="text-sm text-slate-400">רצף הצלחות: {streak} • יציבות סופית: {patientStability}%</p>
                              <button
                                onClick={startCodeBlueGame}
                                className="px-6 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl text-sm transition"
                              >
                                תרגל שוב סימולציה זו
                              </button>
                            </div>

                            {isAnalyzingCodeBlue ? (
                              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                                <Loader2 size={16} className="animate-spin shrink-0" />
                                <span>מנתח את קבלת ההחלטות שלך ומאתר סעיפים מומלצים לחזרה...</span>
                              </div>
                            ) : codeBlueWeaknessFeedback && (
                              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/40 space-y-1.5 text-right">
                                <h4 className="text-xs font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                                  <Target size={15} /> המלצות חזרה על בסיס הטעויות בסימולציה:
                                </h4>
                                <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-200 whitespace-pre-line">
                                  {codeBlueWeaknessFeedback}
                                </p>
                              </div>
                            )}

                            <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                              <h4 className="text-xs font-bold text-slate-400">סיכום תרחישי הסימולציה:</h4>
                              {currentCodeBlueAttempt.cases.map((c: any, idx: number) => {
                                const chosen = codeBlueAnswers[idx];
                                const isRight = chosen === c.correct;
                                return (
                                  <div
                                    key={idx}
                                    className={`p-3.5 rounded-xl border text-xs space-y-1 ${
                                      chosen === undefined
                                        ? 'border-slate-200 dark:border-slate-800 opacity-60'
                                        : isRight
                                        ? 'bg-emerald-500/10 border-emerald-500/30'
                                        : 'bg-red-500/10 border-red-500/30'
                                    }`}
                                  >
                                    <p className="font-bold">תרחיש #{idx + 1}: {c.question}</p>
                                    {chosen !== undefined && (
                                      <p className={isRight ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                                        בחרת: {c.options[chosen]} {isRight ? '✓' : `(הנכון: ${c.options[c.correct]})`}
                                      </p>
                                    )}
                                    {c.rationale && <p className="text-slate-500 dark:text-slate-400">{c.rationale}</p>}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-5">
                            <div className="flex justify-between items-center bg-slate-100 dark:bg-slate-800 p-3.5 rounded-xl">
                              <div className="flex items-center gap-2 font-bold text-rose-500">
                                <Clock size={18} />
                                <span>{timeLeft} שניות</span>
                              </div>
                              <div className="flex items-center gap-2 font-bold text-amber-500">
                                <Flame size={18} />
                                <span>רצף: {streak}</span>
                              </div>
                              <div className="text-xs font-bold">
                                מדדים: <span className={patientStability > 50 ? 'text-emerald-500' : 'text-rose-500'}>{patientStability}%</span>
                              </div>
                            </div>

                            <div className="p-4 rounded-xl bg-rose-500/5 border border-rose-500/20 space-y-2">
                              <span className="text-xs font-bold text-rose-500 uppercase">תרחיש קליני #{caseIndex + 1}</span>
                              <p className="text-sm font-medium leading-relaxed">{currentCodeBlueAttempt.cases[caseIndex].scenario}</p>
                              <p className="text-sm font-bold pt-2">{currentCodeBlueAttempt.cases[caseIndex].question}</p>
                            </div>

                            <div className="space-y-2">
                              {currentCodeBlueAttempt.cases[caseIndex].options.map((opt: string, idx: number) => (
                                <button
                                  key={idx}
                                  onClick={() =>
                                    handleGameAnswer(
                                      idx,
                                      currentCodeBlueAttempt.cases[caseIndex].correct,
                                      currentCodeBlueAttempt.cases.length
                                    )
                                  }
                                  className="w-full text-right p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-rose-500 hover:bg-rose-500/5 text-sm font-medium transition"
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {studyContent.codeBlueAttempts?.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3 shadow-sm">
                          <h4 className="text-sm font-bold flex items-center gap-2 text-slate-700 dark:text-slate-200">
                            <History size={16} className="text-rose-500" />
                            היסטוריית סימולציות Code Blue ({studyContent.codeBlueAttempts.length})
                          </h4>
                          <div className="space-y-2">
                            {studyContent.codeBlueAttempts.map((att: any, idx: number) => {
                              const num = studyContent.codeBlueAttempts.length - idx;
                              const isSelected = idx === activeCodeBlueAttemptIdx;
                              return (
                                <button
                                  key={att.id}
                                  onClick={() => loadCodeBlueAttemptState(att, idx)}
                                  className={`w-full p-3 rounded-xl border text-right flex items-center justify-between text-xs transition ${
                                    isSelected
                                      ? 'border-rose-500 bg-rose-500/10 font-semibold'
                                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-rose-500">Code Blue #{num}</span>
                                    <span className="text-slate-400">• {att.createdAt}</span>
                                  </div>
                                  <span
                                    className={`px-2.5 py-0.5 rounded-full font-bold ${
                                      att.completed
                                        ? att.finalStability > 0
                                          ? 'bg-emerald-500/15 text-emerald-500'
                                          : 'bg-red-500/15 text-red-500'
                                        : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                                    }`}
                                  >
                                    {att.completed ? `יציבות: ${att.finalStability}%` : 'טרם הושלם'}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                )}
              </div>

              <div className="lg:col-span-5">
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col h-[620px] sticky top-24 shadow-sm">
                  <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="bg-blue-600/10 text-blue-500 p-2 rounded-lg">
                        <MessageSquare size={18} />
                      </div>
                      <div>
                        <h3 className="font-bold text-sm">מרצה קליני (AI Nursing Tutor)</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          מחובר למסך: <span className="font-semibold text-blue-500">{getTabHebrewLabel()}</span>
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 p-4 overflow-y-auto space-y-3">
                    {chatMessages.map((msg, i) => (
                      <div
                        key={i}
                        className={`p-3.5 rounded-2xl text-sm max-w-[85%] leading-relaxed whitespace-pre-line ${
                          msg.role === 'user'
                            ? 'bg-blue-600 text-white mr-auto rounded-bl-none'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 ml-auto rounded-br-none'
                        }`}
                      >
                        {msg.text}
                      </div>
                    ))}
                    {isChatLoading && (
                      <div className="text-xs text-slate-400 flex items-center gap-1.5">
                        <Loader2 size={14} className="animate-spin" /> חושב...
                      </div>
                    )}
                  </div>

                  <form onSubmit={handleSendMessage} className="p-3 border-t border-slate-200 dark:border-slate-800 flex gap-2">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder={
                        activeTab === 'game'
                          ? 'שאל על תרחיש ה-Code Blue שלפניך...'
                          : activeTab === 'quiz'
                          ? 'שאל על שאלה מהבוחן שלפניך...'
                          : 'שאל על הסעיף או הכרטיסייה שלפניך...'
                      }
                      className="flex-1 bg-slate-100 dark:bg-slate-800 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
                    />
                    <button
                      type="submit"
                      className="p-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition"
                    >
                      <Send size={18} />
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )
        )}
      </main>

      <footer className="border-t border-slate-200 dark:border-slate-800 py-4 px-6 text-center text-xs text-slate-500 dark:text-slate-400 mt-8">
        © {new Date().getFullYear()} כל הזכויות שמורות למתן פלדמן
      </footer>
    </div>
  );
}
