import React, { useState, useEffect } from 'react';
import { 
  Upload, Calendar, Clock, BookOpen, Moon, Sun, 
  FileText, CheckCircle2, Trash2, Sparkles, ArrowLeft,
  ArrowRight, Send, MessageSquare, HelpCircle, Download, AlertCircle,
  Layers, Award, Activity, RotateCcw, Flame, HeartPulse, Settings, Key, Loader2,
  Plus, FolderOpen, ArrowUp, ArrowDown, Brain, Check, Lock, FilePlus2, ShieldCheck, User
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
// 1. מנוע אחסון IndexedDB (ללא מגבלת 5MB)
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
// 3. חילוץ טקסט וחלוקה סמנטית ללא חפיפות או איבוד חומר
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

function splitFilesIntoDeterministicChunks(files: any[], targetSessionCount: number) {
  const annotatedBlocks: { fileName: string; text: string }[] = [];

  files.forEach((f) => {
    const paragraphs = f.text
      .split(/\n{2,}|(?=\[שקופית \d+\])|(?=\[עמוד \d+\])/)
      .map((p: string) => p.trim())
      .filter((p: string) => p.length > 0);

    paragraphs.forEach((p: string) => {
      annotatedBlocks.push({ fileName: f.name, text: p });
    });
  });

  const totalChars = annotatedBlocks.reduce((acc, b) => acc + b.text.length, 0);
  if (totalChars === 0) {
    return Array.from({ length: targetSessionCount }, (_, i) => ({
      sessionIndex: i,
      fileName: files[0]?.name || 'חומר לימוד',
      textChunk: 'אין טקסט זמין בקובץ.',
      charCount: 0,
    }));
  }

  const targetCharsPerSession = Math.ceil(totalChars / targetSessionCount);
  const chunks: { sessionIndex: number; fileName: string; textChunk: string; charCount: number }[] = [];

  let currentBlocks: { fileName: string; text: string }[] = [];
  let currentLen = 0;

  for (let i = 0; i < annotatedBlocks.length; i++) {
    const block = annotatedBlocks[i];
    currentBlocks.push(block);
    currentLen += block.text.length;

    const remainingSessions = targetSessionCount - chunks.length - 1;
    const remainingBlocks = annotatedBlocks.length - i - 1;

    if (
      remainingSessions > 0 &&
      currentLen >= targetCharsPerSession &&
      remainingBlocks >= remainingSessions
    ) {
      const uniqueFiles = [...new Set(currentBlocks.map((b) => b.fileName))];
      chunks.push({
        sessionIndex: chunks.length,
        fileName: uniqueFiles.join(' + '),
        textChunk: currentBlocks.map((b) => b.text).join('\n\n'),
        charCount: currentLen,
      });
      currentBlocks = [];
      currentLen = 0;
    }
  }

  if (currentBlocks.length > 0) {
    const uniqueFiles = [...new Set(currentBlocks.map((b) => b.fileName))];
    chunks.push({
      sessionIndex: chunks.length,
      fileName: uniqueFiles.join(' + '),
      textChunk: currentBlocks.map((b) => b.text).join('\n\n'),
      charCount: currentLen,
    });
  }

  while (chunks.length < targetSessionCount) {
    const last = chunks[chunks.length - 1];
    chunks.push({
      sessionIndex: chunks.length,
      fileName: last.fileName,
      textChunk: last.textChunk,
      charCount: last.charCount,
    });
  }

  return chunks;
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
// 4. תקשורת AI עם Retry אוטומטי והגנת JSON
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
          temperature: attempt === 1 ? 0.4 : 0.2,
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
      } catch (err) {
        lastError = err;
        console.warn(`ניסיון ${attempt} במודל ${modelName} נכשל, מנסה שוב...`, err);
      } finally {
        clearTimeout(timeoutId);
      }
    }
  }

  throw new Error(`לא התקבלה תשובה תקינה מהמודל. שגיאה: ${lastError?.message || 'שגיאה לא ידועה'}`);
}

async function enrichChunksWithAITitles(apiKey: string, chunks: any[], sessionDuration: number) {
  const previews = chunks.map((c, idx) => ({
    index: idx,
    fileName: c.fileName,
    charCount: c.charCount,
    startPreview: c.textChunk.slice(0, 700),
    midPreview: c.textChunk.slice(Math.floor(c.textChunk.length / 2), Math.floor(c.textChunk.length / 2) + 500),
  }));

  const prompt = `אתה מרצה בכיר לסיעוד. לפניך ${chunks.length} יחידות לימוד רציפות (ללא חפיפה) עבור סשנים של ${sessionDuration} דקות.
לכל יחידה, תן כותרת קלינית מדויקת בעברית ונימוק פדגוגי קצר (משפט אחד) על סמך התוכן האמיתי שלה.
החזר JSON תקין בלבד:
{
  "pedagogicalStrategy": "סקירה קצרה של רצף הלמידה",
  "titles": [
    { "index": 0, "title": "כותרת קלינית מדויקת", "rationale": "נימוק קצר" }
  ]
}
יחידות: ${JSON.stringify(previews)}`;

  return await callGeminiWithFallback(apiKey, prompt, true);
}

async function generateInteractiveLessonBlocks(apiKey: string, topic: string, rawTextChunk: string, duration: number) {
  const cfg = getDurationConfig(duration);
  const fullContext = rawTextChunk.slice(0, 35000);

  const prompt = `אתה מרצה ומדריך קליני בסיעוד. בנה שיעור אינטראקטיבי בעברית לנושא '${topic}' עבור סשן של ${duration} דקות.
הנחיית תעדוף זמן: ${cfg.triageMode}

חלק את השיעור ל-${cfg.blocksCount} שלבי לימוד עוקבים (blocks).
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

  const parsed = await callGeminiWithFallback(apiKey, prompt, true);

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

  return await callGeminiWithFallback(apiKey, prompt, true);
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

  const parsed = await callGeminiWithFallback(apiKey, prompt, true);
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

  const parsed = await callGeminiWithFallback(apiKey, prompt, true);
  return Array.isArray(parsed) ? parsed.map(shuffleQuestionOptions) : [];
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
// 5. הקומפוננטה הראשית
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

  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);

  const [cardIndex, setCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [knownCards, setKnownCards] = useState<number[]>([]);

  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);

  const [gameStarted, setGameStarted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(60);
  const [caseIndex, setCaseIndex] = useState(0);
  const [patientStability, setPatientStability] = useState(100);
  const [streak, setStreak] = useState(0);
  const [gameOver, setGameOver] = useState(false);

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
      setGameOver(true);
      return;
    }
    const timer = setInterval(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearInterval(timer);
  }, [gameStarted, gameOver, timeLeft, activeTab]);

  const saveApiKey = (val: string) => {
    setApiKey(val);
    localStorage.setItem('medstudy_api_key', val);
  };

  const saveUserName = (val: string) => {
    setUserName(val);
    localStorage.setItem('medstudy_user_name', val);
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
            name: `המשך: ${s.topic}`,
            text: s.textChunk,
            wordCount: s.textChunk.split(/\s+/).length,
          }))
      : [];

    const allFilesToSchedule = [...uncompletedOldFiles, ...files];
    const deterministicChunks = splitFilesIntoDeterministicChunks(allFilesToSchedule, studyDates.length);

    if (apiKey.trim()) {
      setIsPlanningAI(true);
      try {
        const aiTitles = await enrichChunksWithAITitles(apiKey.trim(), deterministicChunks, sessionDuration);
        const plannedSessions = deterministicChunks.map((chunk, idx) => {
          const meta = aiTitles.titles?.find((t: any) => t.index === idx) || aiTitles.titles?.[idx];
          return {
            title: meta?.title || `${chunk.fileName} (חלק ${idx + 1})`,
            fileName: chunk.fileName,
            rationale: meta?.rationale || 'חלוקה רציפה מלאה של החומר',
            textChunk: chunk.textChunk,
            charCount: chunk.charCount,
          };
        });

        setDraftPlan({
          strategy: aiTitles.pedagogicalStrategy || 'כל החומר חולק במלואו ללא חפיפות על פני הימים הנותרים.',
          dates: studyDates,
          sessions: plannedSessions,
          preservedCompleted: completedSessions,
        });
        setStep(1.5);
      } catch (err: any) {
        alert('שגיאה בתכנון מול ה-AI: ' + err.message);
      } finally {
        setIsPlanningAI(false);
      }
    } else {
      const fallbackSessions = deterministicChunks.map((chunk, idx) => ({
        title: `${chunk.fileName} - יחידה ${idx + 1}`,
        fileName: chunk.fileName,
        rationale: 'חלוקה רציפה מלאה של הטקסט',
        textChunk: chunk.textChunk,
        charCount: chunk.charCount,
      }));

      setDraftPlan({
        strategy: 'חלוקה רציפה של כל החומר ללא איבוד טקסט.',
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
      const merged = { ...prev, ...patch };
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

  const startSession = async (session: any) => {
    setActiveSession(session);
    setActiveTab('learn');
    setUnlockedBlockIdx(session.completed ? 999 : 0);
    setBlockAnswers({});
    setIsLessonMastered(session.completed);
    setCardIndex(0);
    setIsFlipped(false);
    setKnownCards([]);
    setQuizAnswers({});
    setQuizSubmitted(false);
    setGameStarted(false);
    setStep(3);

    const cleanName = userName.trim();
    const greeting = cleanName ? `היי ${cleanName}!` : 'היי!';

    setChatMessages([
      {
        role: 'ai',
        text: `${greeting} התחלנו את "${session.topic}" (${session.duration} דקות). נלמד שלב אחרי שלב — ענה על שאלת הבדיקה בסוף כל הסבר כדי לפתוח את השלב הבא ולשחרר את התרגול.`,
      },
    ]);

    if (session.savedContent?.blocks) {
      setStudyContent(session.savedContent);
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
      } catch (err: any) {
        alert('שגיאה בבניית השיעור: ' + err.message);
        setStudyContent(getFallbackLesson(session.topic, session.duration));
      } finally {
        setIsLoadingAI(false);
      }
    } else {
      setStudyContent(getFallbackLesson(session.topic, session.duration));
    }
  };

  const handleBlockOptionSelect = (blockIdx: number, optIdx: number, correctIdx: number, totalBlocks: number) => {
    setBlockAnswers((prev) => ({ ...prev, [blockIdx]: optIdx }));

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

  const handleTabSwitch = async (targetTab: 'learn' | 'flashcards' | 'quiz' | 'game') => {
    if (targetTab !== 'learn' && !isLessonMastered) {
      return;
    }

    setActiveTab(targetTab);

    if (targetTab === 'flashcards' && !studyContent?.flashcards) {
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
      } catch (err: any) {
        alert('שגיאה ביצירת כרטיסיות: ' + err.message);
      } finally {
        setIsLoadingTabContent(false);
      }
    }

    if (targetTab === 'quiz' && !studyContent?.chapterQuiz) {
      if (!apiKey.trim()) {
        updateSessionSavedContent(activeSession.id, {
          chapterQuiz: [{ q: 'שאלת הדגמה', opts: ['תשובה נכונה', 'מסיח'], ans: 0, explanation: 'הסבר' }],
        });
        return;
      }
      setIsLoadingTabContent(true);
      try {
        const quiz = await generateQuizOnly(apiKey.trim(), activeSession.textChunk, activeSession.duration);
        updateSessionSavedContent(activeSession.id, { chapterQuiz: quiz });
      } catch (err: any) {
        alert('שגיאה ביצירת הבוחן: ' + err.message);
      } finally {
        setIsLoadingTabContent(false);
      }
    }

    if (targetTab === 'game' && !studyContent?.codeBlueCases) {
      if (!apiKey.trim()) {
        updateSessionSavedContent(activeSession.id, {
          codeBlueCases: [{ scenario: 'תרחיש הדגמה', question: 'מה עושים?', options: ['פעולה נכונה', 'טעות'], correct: 0 }],
        });
        return;
      }
      setIsLoadingTabContent(true);
      try {
        const cases = await generateCodeBlueOnly(apiKey.trim(), activeSession.textChunk);
        updateSessionSavedContent(activeSession.id, { codeBlueCases: cases });
      } catch (err: any) {
        alert('שגיאה ביצירת סימולציית Code Blue: ' + err.message);
      } finally {
        setIsLoadingTabContent(false);
      }
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

  const regenerateNewQuiz = async () => {
    if (!apiKey.trim()) return;
    setIsLoadingTabContent(true);
    try {
      const quiz = await generateQuizOnly(apiKey.trim(), activeSession.textChunk, activeSession.duration);
      updateSessionSavedContent(activeSession.id, { chapterQuiz: quiz });
      setQuizAnswers({});
      setQuizSubmitted(false);
    } catch (err: any) {
      alert('שגיאה: ' + err.message);
    } finally {
      setIsLoadingTabContent(false);
    }
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
        { role: 'ai', text: 'כדי שאוכל לענות מתוך הקבצים שלך, הזן מפתח Gemini API בהגדרות למעלה.' },
      ]);
      return;
    }

    setIsChatLoading(true);
    try {
      const studentContext = userName.trim() ? `שם הסטודנט/ית הוא ${userName.trim()}.` : '';
      const reply = await callGeminiWithFallback(
        apiKey.trim(),
        `אתה מרצה ומדריך קליני בכיר בסיעוד. ${studentContext} ענה בעברית מקצועית וממוקדת לשאלת הסטודנט על בסיס חומר הלימוד:\n\nחומר הלימוד:\n${activeSession.textChunk.slice(0, 30000)}\n\nשאלת הסטודנט: ${userMsg}`,
        false
      );
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
  };

  const handleGameAnswer = (selectedIdx: number, correctIdx: number, totalCases: number) => {
    if (selectedIdx === correctIdx) {
      setStreak((s) => s + 1);
      setPatientStability((p) => Math.min(100, p + 10));
    } else {
      setStreak(0);
      setPatientStability((p) => {
        const next = p - 35;
        if (next <= 0) setGameOver(true);
        return Math.max(0, next);
      });
    }

    if (caseIndex + 1 < totalCases) {
      setCaseIndex((c) => c + 1);
    } else {
      setGameOver(true);
    }
  };

  return (
    <div dir="rtl" className={darkMode ? 'dark bg-slate-950 text-slate-100 min-h-screen' : 'bg-slate-50 text-slate-900 min-h-screen'}>
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
              onClick={() => setStep(2)}
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
                השם ומפתח ה-API נשמרים בדפדפן שלך בלבד. ניתן להנפיק מפתח חינמי ב-Google AI Studio.
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

      <main className="max-w-6xl mx-auto p-6">
        {step === 0 && (
          <div className="space-y-6 mt-4">
            <div className="flex flex-wrap justify-between items-center gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <div>
                <h2 className="text-2xl font-bold">
                  {userName.trim() ? `הקורסים של ${userName.trim()}` : 'הקורסים שלי בסיעוד'}
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-0.5">
                  <ShieldCheck size={15} className="text-emerald-500" />
                  אחסון מורחב פעיל (IndexedDB) — 100% מחומרי הלימוד נשמרים ללא קיצוץ
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
                const completedCount = course.schedule.filter((s: any) => s.completed).length;
                const totalCount = course.schedule.length;
                const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

                return (
                  <div
                    key={course.id}
                    onClick={() => {
                      setActiveCourseId(course.id);
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
                        {course.filesCount} קבצים • {totalCount} סשנים של {course.sessionDuration} דק׳
                      </p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between text-xs font-semibold">
                        <span className="text-slate-400">התקדמות בקורס</span>
                        <span className={progress === 100 ? 'text-emerald-500' : 'text-blue-500'}>
                          {completedCount}/{totalCount} ({progress}%)
                        </span>
                      </div>
                      <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${progress === 100 ? 'bg-emerald-500' : 'bg-blue-600'}`}
                          style={{ width: `${progress}%` }}
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
                    ? 'הסשנים שכבר השלמת יישמרו. החומר החדש והסשנים שטרם נלמדו ייפרסו מחדש על הימים שנותרו עד המבחן.'
                    : 'כל הטקסט מהקבצים יישמר ויחולק במלואו ללא חפיפות או קיצוץ שקט.'}
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
                      <span>מחלק את כל החומר ללא חפיפות...</span>
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
                    <Brain size={14} /> בקרת סילבוס (100% כיסוי חומר • 0% חפיפה)
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
                  {activeCourse.schedule.length} משימות למידה • הושלמו {activeCourse.schedule.filter((s: any) => s.completed).length}/{activeCourse.schedule.length}
                </p>
              </div>
              <div className="flex flex-wrap gap-2.5">
                <button
                  onClick={openAddMaterialToCourse}
                  className="px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 text-sm font-semibold flex items-center gap-2 transition"
                >
                  <FilePlus2 size={16} />
                  הוסף חומר ועדכן לו"ז
                </button>
                <button
                  onClick={exportToCalendarTasks}
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium flex items-center gap-2 shadow-sm transition"
                >
                  <Download size={16} />
                  ייצא ליומן גוגל (.ics)
                </button>
              </div>
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
              <h3 className="text-lg font-bold">המרצה הקליני בונה שיעור אינטראקטיבי מדורג...</h3>
              <p className="text-sm text-slate-400">מתאים את היקף ההסברים ל-{activeSession.duration} דקות ומכין שאלות בדיקה לכל שלב</p>
            </div>
          ) : studyContent && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-2">
              <div className="lg:col-span-7 space-y-5">
                <div className="grid grid-cols-4 gap-2 bg-white dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                  {[
                    { id: 'learn' as const, label: 'שיעור מודרך', icon: BookOpen, locked: false },
                    { id: 'flashcards' as const, label: 'כרטיסיות', icon: Layers, locked: !isLessonMastered },
                    { id: 'quiz' as const, label: 'בוחן מסכם', icon: Award, locked: !isLessonMastered },
                    { id: 'game' as const, label: 'Code Blue', icon: Activity, locked: !isLessonMastered },
                  ].map((tab) => {
                    const Icon = tab.icon;
                    const active = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        disabled={tab.locked}
                        onClick={() => handleTabSwitch(tab.id)}
                        title={tab.locked ? 'השלם את כל שלבי השיעור כדי לפתוח טאב זה' : ''}
                        className={`py-2.5 px-3 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 transition ${
                          tab.locked
                            ? 'opacity-45 cursor-not-allowed text-slate-400'
                            : active
                            ? tab.id === 'game' ? 'bg-rose-600 text-white shadow-sm' : 'bg-blue-600 text-white shadow-sm'
                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        {tab.locked ? <Lock size={14} /> : <Icon size={16} />}
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>

                {!isLessonMastered && (
                  <div className="px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-2">
                    <Lock size={14} className="shrink-0" />
                    <span>
                      <strong>למידה מבוקרת (Mastery Gate):</strong> טאבי הכרטיסיות, הבוחן ו-Code Blue ייפתחו אוטומטית מיד כשתשלים את כל {studyContent.blocks?.length} שלבי השיעור למטה.
                    </span>
                  </div>
                )}

                {activeTab === 'learn' && (
                  <div className="space-y-5">
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
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

                    {studyContent.blocks?.map((block: any, bIdx: number) => {
                      if (bIdx > unlockedBlockIdx) return null;

                      const chosenOpt = blockAnswers[bIdx];
                      const hasAnswered = chosenOpt !== undefined;
                      const isCorrect = chosenOpt === block.correctIndex;

                      return (
                        <div
                          key={bIdx}
                          className={`bg-white dark:bg-slate-900 p-6 rounded-2xl border-2 transition space-y-4 shadow-sm ${
                            isCorrect || isLessonMastered
                              ? 'border-emerald-500/40'
                              : 'border-blue-500/40'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <h3 className="font-bold text-base text-blue-600 dark:text-blue-400 flex items-center gap-2">
                              <span className="bg-blue-600 text-white text-xs w-6 h-6 rounded-lg flex items-center justify-center shrink-0">
                                {bIdx + 1}
                              </span>
                              {block.title}
                            </h3>
                            {(isCorrect || isLessonMastered) && (
                              <span className="text-xs font-bold text-emerald-500 flex items-center gap-1">
                                <CheckCircle2 size={15} /> הובן
                              </span>
                            )}
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
                      <p className="text-sm font-semibold">מייצר כרטיסיות שינון ממוקדות...</p>
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
                            setIsFlipped(false);
                            setCardIndex((prev) => (prev + 1) % studyContent.flashcards.length);
                          }}
                          className="flex-1 py-3 rounded-xl border border-amber-500/40 text-amber-500 font-semibold text-sm hover:bg-amber-500/10 transition"
                        >
                          צריך לחזור שוב
                        </button>
                        <button
                          onClick={() => {
                            const currentId = studyContent.flashcards[cardIndex]?.id || cardIndex;
                            if (!knownCards.includes(currentId)) setKnownCards([...knownCards, currentId]);
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
                  isLoadingTabContent || !studyContent.chapterQuiz ? (
                    <div className="bg-white dark:bg-slate-900 p-12 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center space-y-3">
                      <Loader2 size={32} className="text-blue-500 animate-spin" />
                      <p className="text-sm font-semibold">בונה שאלות בחינה קליניות ומערבב אפשרויות...</p>
                    </div>
                  ) : (
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-6 shadow-sm">
                      <div className="flex justify-between items-center">
                        <h3 className="font-bold text-lg">בוחן אמריקאי ({studyContent.chapterQuiz.length} שאלות)</h3>
                        <button
                          onClick={regenerateNewQuiz}
                          className="text-xs px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-500 font-semibold hover:bg-blue-500/20 flex items-center gap-1 transition"
                        >
                          <RotateCcw size={14} /> שאלות חדשות
                        </button>
                      </div>

                      {studyContent.chapterQuiz.map((item: any, qIdx: number) => (
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
                          onClick={() => setQuizSubmitted(true)}
                          className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition shadow-lg shadow-blue-600/20"
                        >
                          הגש בוחן וקבל משוב מלא
                        </button>
                      ) : (
                        <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30 flex justify-between items-center">
                          <span className="font-bold text-blue-500">
                            ציון: {studyContent.chapterQuiz.filter((q: any, i: number) => quizAnswers[i] === q.ans).length} מתוך {studyContent.chapterQuiz.length}
                          </span>
                          <button
                            onClick={() => {
                              setQuizAnswers({});
                              setQuizSubmitted(false);
                            }}
                            className="text-xs underline flex items-center gap-1 font-semibold"
                          >
                            <RotateCcw size={14} /> נסה שוב
                          </button>
                        </div>
                      )}
                    </div>
                  )
                )}

                {activeTab === 'game' && (
                  isLoadingTabContent || !studyContent.codeBlueCases ? (
                    <div className="bg-white dark:bg-slate-900 p-12 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center space-y-3">
                      <Loader2 size={32} className="text-rose-500 animate-spin" />
                      <p className="text-sm font-semibold">מכין תרחישי חירום קליניים...</p>
                    </div>
                  ) : (
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border-2 border-rose-500/40 space-y-6 shadow-sm">
                      {!gameStarted ? (
                        <div className="text-center py-8 space-y-4">
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
                        <div className="text-center py-8 space-y-4">
                          <h3 className="text-2xl font-bold">
                            {patientStability > 0 ? 'המטופל יוצב בהצלחה במחלקה! 🎉' : 'המטופל פיתח הידרדרות קלינית ⚠️'}
                          </h3>
                          <p className="text-sm text-slate-400">רצף הצלחות: {streak} • יציבות סופית: {patientStability}%</p>
                          <button
                            onClick={startCodeBlueGame}
                            className="px-6 py-3 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl transition"
                          >
                            שחק שוב
                          </button>
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
                            <p className="text-sm font-medium leading-relaxed">{studyContent.codeBlueCases[caseIndex].scenario}</p>
                            <p className="text-sm font-bold pt-2">{studyContent.codeBlueCases[caseIndex].question}</p>
                          </div>

                          <div className="space-y-2">
                            {studyContent.codeBlueCases[caseIndex].options.map((opt: string, idx: number) => (
                              <button
                                key={idx}
                                onClick={() =>
                                  handleGameAnswer(
                                    idx,
                                    studyContent.codeBlueCases[caseIndex].correct,
                                    studyContent.codeBlueCases.length
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
                  )
                )}
              </div>

              <div className="lg:col-span-5">
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col h-[620px] sticky top-24 shadow-sm">
                  <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2.5">
                    <div className="bg-blue-600/10 text-blue-500 p-2 rounded-lg">
                      <MessageSquare size={18} />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm">מרצה קליני (AI Nursing Tutor)</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">מבוסס על מלוא חומר הלימוד של הסשן</p>
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
                      placeholder="בקש הבהרה קלינית או דוגמה נוספת..."
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
    </div>
  );
}
