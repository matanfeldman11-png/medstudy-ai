import React, { useState, useEffect } from 'react';
import { 
  Upload, Calendar, Clock, BookOpen, Moon, Sun, 
  FileText, CheckCircle2, Trash2, Sparkles, ArrowLeft,
  ArrowRight, Send, MessageSquare, HelpCircle, Download, AlertCircle,
  Layers, Award, Activity, RotateCcw, Flame, HeartPulse, Settings, Key, Loader2,
  Plus, FolderOpen, ArrowUp, ArrowDown, Brain, Check
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

async function extractTextFromFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
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
      fullText += content.items.map((item) => item.str).join(' ') + '\n';
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
    const slideFiles = Object.keys(zip.files).filter((name) => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'));
    for (const slideName of slideFiles) {
      const xml = await zip.files[slideName].async('text');
      const matches = xml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g) || [];
      slideText += matches.map((tag) => tag.replace(/<[^>]+>/g, '')).join(' ') + '\n';
    }
    return slideText;
  }

  return '';
}

function getSmartCoveredText(text, maxChars = 25000) {
  if (!text || text.length <= maxChars) return text;
  const partSize = Math.floor(maxChars / 3);
  const start = text.slice(0, partSize);
  const midStart = Math.floor(text.length / 2) - Math.floor(partSize / 2);
  const middle = text.slice(midStart, midStart + partSize);
  const end = text.slice(text.length - partSize);
  return `${start}\n\n[...המשך חומר לימוד מעמיק...]\n\n${middle}\n\n[...חלק מתקדם נוסף...]\n\n${end}`;
}

async function callGeminiWithFallback(apiKey, prompt, isJson = true) {
  const models = [
    { name: 'gemini-3.8-flash', timeout: 15000 },
    { name: 'gemini-3.5-flash-lite', timeout: 25000 }
  ];
  let lastError = null;

  for (const m of models) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), m.timeout);

    try {
      const generationConfig = {};
      if (isJson) generationConfig.responseMimeType = 'application/json';

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${m.name}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig
          })
        }
      );

      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      return data.candidates[0].content.parts[0].text;
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError;
}

async function buildAISyllabusPlan(apiKey, files, totalSessionsCount, sessionDuration) {
  const filesCatalog = files.map((f, idx) => ({
    fileIndex: idx,
    fileName: f.name,
    wordCount: f.wordCount,
    excerpt: f.text.slice(0, 600)
  }));

  const prompt = `אתה מרצה בכיר לסיעוד. סדר ${files.length} קבצים על פני בדיוק ${totalSessionsCount} סשנים של ${sessionDuration} דקות מהבסיס למתקדם.
החזר JSON תקין בלבד:
{
  "pedagogicalStrategy": "סקירה קצרה של סדר הלימוד",
  "sessions": [
    {
      "sessionNumber": 1,
      "title": "כותרת מקצועית לסשן בסיעוד",
      "fileIndex": 0,
      "startPercent": 0,
      "endPercent": 50,
      "rationale": "נימוק קצר"
    }
  ]
}
קבצים: ${JSON.stringify(filesCatalog)}`;

  const jsonText = await callGeminiWithFallback(apiKey, prompt, true);
  return JSON.parse(jsonText);
}

// יצירת יחידת לימוד מורחבת המכילה בדיוק 8 כותרות, ותחת כל כותרת לפחות 10 משפטים מפורטים
async function generateAIStudyMaterial(apiKey, topic, rawTextChunk) {
  const coveredText = getSmartCoveredText(rawTextChunk, 25000);

  const prompt = `מרצה בכיר לסיעוד: בנה יחידת לימוד אקדמית, מקיפה ומעמיקה מאוד בעברית לנושא "${topic}" מתוך טקסט החובה המצורף.
דרישות קפדניות לשדה הלימוד (sections):
- עליך לחשוב על ולבנות בדיוק 8 כותרות מרכזיות (sections) המכסות את כלל החומר הקליני והפתופיזיולוגי.
- תחת כל אחת מה-8 כותרות, שדה התוכן (content) חייב להכיל **לפחות 10 משפטים מלאים, ארוכים ומפורטים** העוסקים ברציונל הרפואי, בפתופיזיולוגיה, בהערכה הסיעודית ובטיפול הקליני. אל תסתפק במשפטים קצרים!
- בנוסף, ספק 10 כרטיסיות שינון מפורטות, בוחן של בדיוק 10 שאלות עם הסברי שגיאות, ו-3 מקרי Code Blue.

החזר JSON תקין בלבד במבנה הבא:
{
  "sections": [
    {
      "title": "כותרת ראשונה בנושא",
      "content": "כאן יופיע טקסט מפורט ועשיר המורכב מלפחות 10 משפטים מלאים ברצף המנתחים את הנושא לעומק ומסבירים את כל ההיבטים הקליניים והסיעודיים..."
    },
    {
      "title": "כותרת שנייה בנושא",
      "content": "כאן יופיע טקסט מפורט ועשיר המורכב מלפחות 10 משפטים מלאים ברצף..."
    },
    {
      "title": "כותרת שלישית בנושא",
      "content": "כאן יופיע טקסט מפורט ועשיר המורכב מלפחות 10 משפטים מלאים ברצף..."
    },
    {
      "title": "כותרת רביעית בנושא",
      "content": "כאן יופיע טקסט מפורט ועשיר המורכב מלפחות 10 משפטים מלאים ברצף..."
    },
    {
      "title": "כותרת חמישית בנושא",
      "content": "כאן יופיע טקסט מפורט ועשיר המורכב מלפחות 10 משפטים מלאים ברצף..."
    },
    {
      "title": "כותרת שישית בנושא",
      "content": "כאן יופיע טקסט מפורט ועשיר המורכב מלפחות 10 משפטים מלאים ברצף..."
    },
    {
      "title": "כותרת שביעית בנושא",
      "content": "כאן יופיע טקסט מפורט ועשיר המורכב מלפחות 10 משפטים מלאים ברצף..."
    },
    {
      "title": "כותרת שמינית בנושא",
      "content": "כאן יופיע טקסט מפורט ועשיר המורכב מלפחות 10 משפטים מלאים ברצף..."
    }
  ],
  "comparisonTable": [
    {"param": "פרמטר", "acute": "ממצא א׳", "chronic": "ממצא ב׳"}
  ],
  "comprehensionCheck": {
    "question": "שאלת הבנה קלינית",
    "options": ["תשובה נכונה", "מסיח 1", "מסיח 2"],
    "correctIndex": 0
  },
  "flashcards": [
    {"id": 1, "front": "מושג 1", "back": "הסבר מפורט 1"},
    {"id": 2, "front": "מושג 2", "back": "הסבר מפורט 2"},
    {"id": 3, "front": "מושג 3", "back": "הסבר מפורט 3"},
    {"id": 4, "front": "מושג 4", "back": "הסבר מפורט 4"},
    {"id": 5, "front": "מושג 5", "back": "הסבר מפורט 5"},
    {"id": 6, "front": "מושג 6", "back": "הסבר מפורט 6"},
    {"id": 7, "front": "מושג 7", "back": "הסבר מפורט 7"},
    {"id": 8, "front": "מושג 8", "back": "הסבר מפורט 8"},
    {"id": 9, "front": "מושג 9", "back": "הסבר מפורט 9"},
    {"id": 10, "front": "מושג 10", "back": "הסבר מפורט 10"}
  ],
  "chapterQuiz": [
    { "q": "שאלה 1", "opts": ["נכונה", "מסיח 1", "מסיח 2", "מסיח 3"], "ans": 0, "explanation": "הסבר קליני מלא 1" },
    { "q": "שאלה 2", "opts": ["מסיח 1", "נכונה", "מסיח 2", "מסיח 3"], "ans": 1, "explanation": "הסבר קליני מלא 2" },
    { "q": "שאלה 3", "opts": ["מסיח 1", "מסיח 2", "נכונה", "מסיח 3"], "ans": 2, "explanation": "הסבר קליני מלא 3" },
    { "q": "שאלה 4", "opts": ["נכונה", "מסיח 1", "מסיח 2", "מסיח 3"], "ans": 0, "explanation": "הסבר קליני מלא 4" },
    { "q": "שאלה 5", "opts": ["מסיח 1", "מסיח 2", "מסיח 3", "נכונה"], "ans": 3, "explanation": "הסבר קליני מלא 5" },
    { "q": "שאלה 6", "opts": ["נכונה", "מסיח 1", "מסיח 2", "מסיח 3"], "ans": 0, "explanation": "הסבר קליני מלא 6" },
    { "q": "שאלה 7", "opts": ["מסיח 1", "נכונה", "מסיח 2", "מסיח 3"], "ans": 1, "explanation": "הסבר קליני מלא 7" },
    { "q": "שאלה 8", "opts": ["מסיח 1", "מסיח 2", "נכונה", "מסיח 3"], "ans": 2, "explanation": "הסבר קליני מלא 8" },
    { "q": "שאלה 9", "opts": ["נכונה", "מסיח 1", "מסיח 2", "מסיח 3"], "ans": 0, "explanation": "הסבר קליני מלא 9" },
    { "q": "שאלה 10", "opts": ["מסיח 1", "מסיח 2", "מסיח 3", "נכונה"], "ans": 3, "explanation": "הסבר קליני מלא 10" }
  ],
  "codeBlueCases": [
    {"scenario": "מקרה קליני 1", "question": "מה הפעולה?", "options": ["נכונה", "טעות 1", "טעות 2"], "correct": 0},
    {"scenario": "מקרה קליני 2", "question": "מה הפעולה?", "options": ["טעות 1", "נכונה", "טעות 2"], "correct": 1},
    {"scenario": "מקרה קליני 3", "question": "מה הפעולה?", "options": ["טעות 1", "טעות 2", "נכונה"], "correct": 2}
  ]
}

טקסט החובה:
${coveredText}`;

  const jsonText = await callGeminiWithFallback(apiKey, prompt, true);
  return JSON.parse(jsonText);
}

const getFallbackContent = (topic) => ({
  sections: Array.from({ length: 8 }, (_, i) => ({
    title: `כותרת לימוד מספר ${i + 1} בנושא ${topic}`,
    content: `זהו תוכן הדגמה עבור כותרת ${i + 1}. על מנת שהמערכת תיצור 8 כותרות מפורטות המכילות כל אחת לפחות 10 משפטים קליניים מתוך הקבצים שלך, עליך לחבר מפתח Gemini API חופשי דרך כפתור ההגדרות בראש העמוד. ברגע שהמפתח מחובר, המערכת תבצע ניתוח מעמיק ואמיתי של כל חומר הלימוד שלך ותציג את כל הפירוט הנדרש לשעה שלמה של תרגול סיעודי מעמיק ויסודי.`
  })),
  comparisonTable: [
    { param: 'סטטוס', acute: 'Demo', chronic: 'AI מלא' }
  ],
  comprehensionCheck: {
    question: 'איך מפעילים ניתוח מלא?',
    options: ['הזנת מפתח API', 'סגירה'],
    correctIndex: 0
  },
  flashcards: Array.from({ length: 10 }, (_, i) => ({
    id: i + 1,
    front: `מושג הדגמה מספר ${i + 1}`,
    back: `הסבר מפורט עבור מושג מספר ${i + 1} במצב הדגמה.`
  })),
  chapterQuiz: Array.from({ length: 10 }, (_, i) => ({
    q: `שאלת הדגמה מספר ${i + 1} לבחינה קלינית?`,
    opts: ['תשובה נכונה', 'מסיח 1', 'מסיח 2', 'מסיח 3'],
    ans: 0,
    explanation: `הסבר מפורט לשאלה ${i + 1}: מדוע זו התשובה הנכונה ומה משמעות השגיאה.`
  })),
  codeBlueCases: [
    {
      scenario: 'תרחיש קליני במיון לבדיקת תפקוד.',
      question: 'מה הפעולה הנדרשת?',
      options: ['פעולה נכונה', 'שגיאה 1', 'שגיאה 2'],
      correct: 0
    }
  ]
});

export default function App() {
  const [darkMode, setDarkMode] = useState(true);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('medstudy_api_key') || '');
  const [showSettings, setShowSettings] = useState(false);

  const [courses, setCourses] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('medstudy_courses')) || [];
      return saved.map((c) => ({
        ...c,
        schedule: (c.schedule || []).map((s) => ({ ...s, rawDate: new Date(s.rawDate) }))
      }));
    } catch {
      return [];
    }
  });

  const [activeCourseId, setActiveCourseId] = useState(() => localStorage.getItem('medstudy_active_course') || null);
  const [step, setStep] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('medstudy_courses')) || [];
      return saved.length > 0 ? 0 : 1;
    } catch {
      return 1;
    }
  });

  const [courseName, setCourseName] = useState('');
  const [files, setFiles] = useState([]);
  const [isParsingFiles, setIsParsingFiles] = useState(false);
  const [deadline, setDeadline] = useState('');
  const [selectedDays, setSelectedDays] = useState([0, 2, 4]);
  const [sessionDuration, setSessionDuration] = useState(60);

  const [isPlanningAI, setIsPlanningAI] = useState(false);
  const [draftPlan, setDraftPlan] = useState(null);

  const [activeSession, setActiveSession] = useState(null);
  const [studyContent, setStudyContent] = useState(null);
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [activeTab, setActiveTab] = useState('learn');

  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [isQuizPassed, setIsQuizPassed] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);

  const [cardIndex, setCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [knownCards, setKnownCards] = useState([]);

  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [isRegeneratingQuiz, setIsRegeneratingQuiz] = useState(false);

  const [gameStarted, setGameStarted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(60);
  const [caseIndex, setCaseIndex] = useState(0);
  const [patientStability, setPatientStability] = useState(100);
  const [streak, setStreak] = useState(0);
  const [gameOver, setGameOver] = useState(false);

  const activeCourse = courses.find((c) => c.id === activeCourseId) || null;

  useEffect(() => {
    try {
      localStorage.setItem('medstudy_courses', JSON.stringify(courses));
      if (activeCourseId) localStorage.setItem('medstudy_active_course', activeCourseId);
    } catch (e) {
      console.warn('שגיאת אחסון');
    }
  }, [courses, activeCourseId]);

  useEffect(() => {
    if (!gameStarted || gameOver || activeTab !== 'game') return;
    if (timeLeft <= 0) {
      setGameOver(true);
      return;
    }
    const timer = setInterval(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearInterval(timer);
  }, [gameStarted, gameOver, timeLeft, activeTab]);

  const saveApiKey = (val) => {
    setApiKey(val);
    localStorage.setItem('medstudy_api_key', val);
  };

  const openNewCourseForm = () => {
    setCourseName('');
    setFiles([]);
    setDeadline('');
    setSelectedDays([0, 2, 4]);
    setSessionDuration(60);
    setDraftPlan(null);
    setStep(1);
  };

  const handleFileUpload = async (e) => {
    const uploadedFiles = Array.from(e.target.files);
    setIsParsingFiles(true);
    try {
      const processed = await Promise.all(
        uploadedFiles.map(async (file) => {
          const extractedText = await extractTextFromFile(file);
          return {
            id: Math.random().toString(36).substr(2, 9),
            name: file.name,
            size: (file.size / 1024 / 1024).toFixed(2) + ' MB',
            type: file.name.split('.').pop().toUpperCase(),
            text: extractedText || 'לא נמצא טקסט קריא.',
            wordCount: extractedText ? extractedText.split(/\s+/).length : 0
          };
        })
      );
      setFiles((prev) => [...prev, ...processed]);
    } catch (err) {
      alert('שגיאה בקריאת הקובץ: ' + err.message);
    } finally {
      setIsParsingFiles(false);
    }
  };

  const removeFile = (id) => setFiles(files.filter((f) => f.id !== id));

  const toggleDay = (dayId) => {
    setSelectedDays((prev) =>
      prev.includes(dayId) ? prev.filter((d) => d !== dayId) : [...prev, dayId]
    );
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

    const studyDates = [];
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

    if (apiKey.trim()) {
      setIsPlanningAI(true);
      try {
        const aiPlan = await buildAISyllabusPlan(apiKey.trim(), files, studyDates.length, sessionDuration);
        
        const plannedSessions = studyDates.map((date, idx) => {
          const item = aiPlan.sessions[idx] || aiPlan.sessions[aiPlan.sessions.length - 1];
          const targetFile = files[item.fileIndex] || files[0];
          const textLen = targetFile.text.length;
          const startIdx = Math.floor(((item.startPercent || 0) / 100) * textLen);
          const endIdx = Math.floor(((item.endPercent || 100) / 100) * textLen);
          const slice = targetFile.text.slice(startIdx, Math.max(endIdx, startIdx + 3500));

          return {
            title: item.title,
            fileName: targetFile.name,
            rationale: item.rationale,
            textChunk: slice || targetFile.text
          };
        });

        setDraftPlan({
          strategy: aiPlan.pedagogicalStrategy,
          dates: studyDates,
          sessions: plannedSessions
        });
        setStep(1.5);
      } catch (err) {
        alert('שגיאה בתכנון מול ה-AI: ' + err.message);
      } finally {
        setIsPlanningAI(false);
      }
    } else {
      const combinedText = files.map((f) => `--- קובץ: ${f.name} ---\n${f.text}`).join('\n\n');
      const chunkSize = Math.ceil(combinedText.length / studyDates.length);

      const fallbackSessions = studyDates.map((date, index) => {
        const fileIndex = Math.floor((index / studyDates.length) * files.length);
        const currentFile = files[fileIndex];
        const partNumber = (index % Math.ceil(studyDates.length / files.length)) + 1;
        return {
          title: `${currentFile.name.replace(/\.[^/.]+$/, "")} - חלק ${partNumber}`,
          fileName: currentFile.name,
          rationale: 'חלוקה לפי קבצים',
          textChunk: combinedText.slice(index * chunkSize, (index + 1) * chunkSize)
        };
      });

      setDraftPlan({
        strategy: 'חלוקה לינארית של הקבצים.',
        dates: studyDates,
        sessions: fallbackSessions
      });
      setStep(1.5);
    }
  };

  const moveDraftSession = (index, direction) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= draftPlan.sessions.length) return;
    const updated = [...draftPlan.sessions];
    const temp = updated[index];
    updated[index] = updated[targetIdx];
    updated[targetIdx] = temp;
    setDraftPlan({ ...draftPlan, sessions: updated });
  };

  const updateDraftSessionTitle = (index, newTitle) => {
    const updated = [...draftPlan.sessions];
    updated[index] = { ...updated[index], title: newTitle };
    setDraftPlan({ ...draftPlan, sessions: updated });
  };

  const confirmAndSaveCourse = () => {
    if (!draftPlan) return;

    const finalSchedule = draftPlan.dates.map((date, index) => {
      const s = draftPlan.sessions[index];
      return {
        id: index + 1,
        date: date.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'short' }),
        rawDate: date,
        topic: s.title,
        rationale: s.rationale,
        textChunk: s.textChunk,
        duration: sessionDuration,
        completed: false,
        savedContent: null
      };
    });

    const newCourse = {
      id: 'course-' + Date.now(),
      title: courseName.trim() || `קורס סיעוד ${courses.length + 1}`,
      strategy: draftPlan.strategy,
      deadline,
      sessionDuration,
      filesCount: files.length,
      schedule: finalSchedule,
      createdAt: new Date().toLocaleDateString('he-IL')
    };

    setCourses((prev) => [newCourse, ...prev]);
    setActiveCourseId(newCourse.id);
    setDraftPlan(null);
    setStep(2);
  };

  const deleteCourse = (courseId, e) => {
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
    const formatDateOnly = (dateObj) => {
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
      'METHOD:PUBLISH'
    ];

    activeCourse.schedule.forEach((session) => {
      const dateStr = formatDateOnly(session.rawDate);
      icsContent.push(
        'BEGIN:VEVENT',
        `UID:event-medstudy-${activeCourse.id}-${session.id}@medstudy.ai`,
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

  const startSession = async (session) => {
    setActiveSession(session);
    setActiveTab('learn');
    setSelectedAnswer(null);
    setIsQuizPassed(session.completed);
    setCardIndex(0);
    setIsFlipped(false);
    setKnownCards([]);
    setQuizAnswers({});
    setQuizSubmitted(false);
    setGameStarted(false);
    setStep(3);

    setChatMessages([
      {
        role: 'ai',
        text: `היי מתן! טענתי את החומר המלא של "${session.topic}" (סשן של ${session.duration} דקות) הכולל 8 כותרות מפורטות. אני כאן לכל שאלה קלינית!`
      }
    ]);

    if (session.savedContent) {
      setStudyContent(session.savedContent);
      return;
    }

    if (apiKey.trim()) {
      setIsLoadingAI(true);
      try {
        const aiData = await generateAIStudyMaterial(apiKey.trim(), session.topic, session.textChunk);
        setStudyContent(aiData);

        if (activeCourse) {
          setCourses((prev) =>
            prev.map((course) =>
              course.id === activeCourse.id
                ? {
                    ...course,
                    schedule: course.schedule.map((s) =>
                      s.id === session.id ? { ...s, savedContent: aiData } : s
                    )
                  }
                : course
            )
          );
        }
      } catch (err) {
        alert('שגיאה בחיבור ל-AI: ' + err.message);
        setStudyContent(getFallbackContent(session.topic));
      } finally {
        setIsLoadingAI(false);
      }
    } else {
      setStudyContent(getFallbackContent(session.topic));
    }
  };

  const regenerateNewQuiz = async () => {
    if (!apiKey.trim()) {
      alert('יש לחבר מפתח AI בהגדרות כדי לייצר בוחן חדש.');
      return;
    }
    setIsRegeneratingQuiz(true);
    try {
      const freshQuizPrompt = `צור בוחן חדש בן 10 שאלות קליניות רב-בררותיות בעברית אך ורק מתוך טקסט החומר הבא. לכל שאלה 4 אפשרויות והסבר קליני מפורט למה התשובה נכונה ומה משמעות השגיאה.
החזר JSON תקין בלבד במבנה מערך:
[
  {
    "q": "שאלה קלינית",
    "opts": ["אופציה 1", "אופציה 2", "אופציה 3", "אופציה 4"],
    "ans": 0,
    "explanation": "הסבר מפורט"
  }
]
טקסט: ${activeSession.textChunk.slice(0, 15000)}`;

      const resText = await callGeminiWithFallback(apiKey.trim(), freshQuizPrompt, true);
      const newQuizData = JSON.parse(resText);
      setStudyContent((prev) => ({ ...prev, chapterQuiz: newQuizData }));
      setQuizAnswers({});
      setQuizSubmitted(false);
    } catch (err) {
      alert('שגיאה ביצירת בוחן חדש: ' + err.message);
    } finally {
      setIsRegeneratingQuiz(false);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const userMsg = chatInput;
    setChatMessages((prev) => [...prev, { role: 'user', text: userMsg }]);
    setChatInput('');

    if (!apiKey.trim()) {
      setTimeout(() => {
        setChatMessages((prev) => [
          ...prev,
          { role: 'ai', text: 'כדי שאוכל לענות מתוך הקבצים שלך, הזן מפתח Gemini API בהגדרות למעלה.' }
        ]);
      }, 400);
      return;
    }

    setIsChatLoading(true);
    try {
      const reply = await callGeminiWithFallback(
        apiKey.trim(),
        `אתה מרצה ומדריך קליני בכיר בסיעוד. ענה בעברית מקצועית ומעמיקה לשאלת הסטודנט על בסיס חומר הלימוד:\n\nחומר הלימוד:\n${activeSession.textChunk.slice(0, 20000)}\n\nשאלת הסטודנט: ${userMsg}`,
        false
      );
      setChatMessages((prev) => [...prev, { role: 'ai', text: reply || 'לא הצלחתי לנסח תשובה.' }]);
    } catch (err) {
      setChatMessages((prev) => [...prev, { role: 'ai', text: 'שגיאת תקשורת מול ה-AI.' }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleCheckUnderstanding = (idx, correctIdx) => {
    setSelectedAnswer(idx);
    if (idx === correctIdx && activeCourse) {
      setIsQuizPassed(true);
      setCourses((prev) =>
        prev.map((course) =>
          course.id === activeCourse.id
            ? {
                ...course,
                schedule: course.schedule.map((s) =>
                  s.id === activeSession.id ? { ...s, completed: true } : s
                )
              }
            : course
        )
      );
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

  const handleGameAnswer = (selectedIdx, correctIdx, totalCases) => {
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
      <header className="border-b border-slate-200 dark:border-slate-800 px-6 py-4 flex justify-between items-center sticky top-0 backdrop-blur-md bg-white/80 dark:bg-slate-950/80 z-20">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setStep(courses.length > 0 ? 0 : 1)}>
          <div className="bg-blue-600 p-2 rounded-xl text-white">
            <BookOpen size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">MedStudy AI - Nursing</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">מערכת למידה מתקדמת לתואר בסיעוד</p>
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
            <span className="hidden sm:inline">{apiKey ? 'AI מחובר' : 'חבר מפתח AI'}</span>
          </button>
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-900 transition"
          >
            {darkMode ? <Sun size={20} className="text-amber-400" /> : <Moon size={20} className="text-slate-600" />}
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="bg-slate-900 text-white border-b border-slate-800 px-6 py-4">
          <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-sm">
              <p className="font-bold flex items-center gap-1.5 text-blue-400">
                <Key size={16} /> חיבור מנוע Google Gemini AI
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                הדבק מפתח API כדי לאפשר ניתוח עומק של המצגות והסיכומים לסיעוד.
              </p>
            </div>
            <div className="flex w-full sm:w-auto gap-2">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => saveApiKey(e.target.value)}
                placeholder="הדבק כאן מפתח AIza..."
                className="flex-1 sm:w-72 bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2 text-sm outline-none focus:border-blue-500"
              />
              <button
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl text-sm font-semibold"
              >
                שמור
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-6xl mx-auto p-6">
        {step === 0 && (
          <div className="space-y-6 mt-4">
            <div className="flex flex-wrap justify-between items-center gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800">
              <div>
                <h2 className="text-2xl font-bold">הקורסים שלי בסיעוד</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  ניהול קורסים, מעקב התקדמות וניתוח חומרי לימוד קליניים
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
                const completedCount = course.schedule.filter((s) => s.completed).length;
                const totalCount = course.schedule.length;
                const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

                return (
                  <div
                    key={course.id}
                    onClick={() => {
                      setActiveCourseId(course.id);
                      setStep(2);
                    }}
                    className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-blue-500 transition cursor-pointer flex flex-col justify-between space-y-5 group"
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
                      <p className="text-xs text-slate-500">
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
                  1. העלאת חומרי לימוד לקורס
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                  העלה מצגות, סיכומים ונוהלי טיפול לקבלת חומר מלא ללמידה מעמיקה
                </p>

                <label className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition bg-slate-50/50 dark:bg-slate-950/50">
                  {isParsingFiles ? (
                    <Loader2 size={32} className="text-blue-500 mb-3 animate-spin" />
                  ) : (
                    <Upload size={32} className="text-blue-500 mb-3" />
                  )}
                  <span className="font-medium text-sm">
                    {isParsingFiles ? 'מחלץ טקסט מהקבצים...' : 'לחץ לבחירת קבצים או גרור לכאן'}
                  </span>
                  <span className="text-xs text-slate-400 mt-1">PDF, Word, מצגות וטקסט</span>
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
                    <h3 className="text-xs font-semibold uppercase text-slate-400">קבצים שנקראו ({files.length})</h3>
                    {files.map((file) => (
                      <div key={file.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <FileText size={18} className="text-blue-500 shrink-0" />
                          <div className="truncate">
                            <p className="text-sm font-medium truncate">{file.name}</p>
                            <p className="text-xs text-slate-500">{file.type} • {file.wordCount.toLocaleString()} מילים</p>
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
                    2. הגדרות הקורס ותכנון AI
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    קביעת דדליין, ימי לימוד ומשך סשן
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">שם הקורס (למשל: בסיס הסיעוד / קרדיולוגיה)</label>
                  <input
                    type="text"
                    value={courseName}
                    onChange={(e) => setCourseName(e.target.value)}
                    placeholder="הזן שם קורס..."
                    className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">תאריך יעד לבחינה / סיום החומר</label>
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
                    <span>משך כל סשן למידה</span>
                    <span className="text-blue-500 font-bold">{sessionDuration} דקות</span>
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {[30, 45, 60, 90].map((mins) => (
                      <button
                        key={mins}
                        onClick={() => setSessionDuration(mins)}
                        className={`py-2 rounded-xl text-sm font-medium border transition ${
                          sessionDuration === mins
                            ? 'bg-blue-600/10 border-blue-500 text-blue-500'
                            : 'border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        {mins} דק׳
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
                      <span>מתכנן סילבוס קליני...</span>
                    </>
                  ) : (
                    <>
                      <Brain size={20} />
                      <span>בנה תוכנית למידה חכמה</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 1.5 && draftPlan && (
          <div className="space-y-6 mt-4 max-w-4xl mx-auto">
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border-2 border-blue-500/40 space-y-4">
              <div className="flex flex-wrap justify-between items-start gap-4">
                <div>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-500 flex items-center gap-1.5 w-fit">
                    <Brain size={14} /> בקרת סילבוס
                  </span>
                  <h2 className="text-2xl font-bold mt-2">סדר הלמידה לקורס</h2>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setStep(1)}
                    className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    חזרה
                  </button>
                  <button
                    onClick={generateAIDraftPlan}
                    disabled={isPlanningAI}
                    className="px-4 py-2.5 rounded-xl border border-blue-500/40 text-blue-500 text-sm font-semibold hover:bg-blue-500/10 flex items-center gap-1.5"
                  >
                    <RotateCcw size={16} className={isPlanningAI ? 'animate-spin' : ''} />
                    תכנן מחדש
                  </button>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/20 text-sm text-slate-700 dark:text-slate-300">
                <strong className="text-blue-500 block mb-1">היגיון פדגוגי:</strong>
                {draftPlan.strategy}
              </div>

              <div className="space-y-3">
                {draftPlan.sessions.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4"
                  >
                    <div className="flex items-start gap-3 flex-1">
                      <span className="bg-blue-600 text-white font-bold text-xs w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-1">
                        {idx + 1}
                      </span>
                      <div className="space-y-1.5 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span className="font-semibold text-blue-500">
                            {draftPlan.dates[idx]?.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'short' })}
                          </span>
                          <span>•</span>
                          <span>מקור: {item.fileName}</span>
                        </div>
                        <input
                          type="text"
                          value={item.title}
                          onChange={(e) => updateDraftSessionTitle(idx, e.target.value)}
                          className="w-full font-bold text-sm bg-transparent border-b border-transparent focus:border-blue-500 outline-none py-0.5"
                        />
                        <p className="text-xs text-emerald-500/90 flex items-center gap-1">
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
                אשר תוכנית וצור לוח זמנים ({draftPlan.sessions.length} סשנים)
              </button>
            </div>
          </div>
        )}

        {step === 2 && activeCourse && (
          <div className="space-y-6 mt-4">
            <div className="flex flex-wrap justify-between items-center gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800">
              <div className="space-y-1 max-w-2xl">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold px-2.5 py-0.5 rounded-md bg-blue-500/10 text-blue-500">קורס פעיל</span>
                  <h2 className="text-xl font-bold">{activeCourse.title}</h2>
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {activeCourse.schedule.length} משימות למידה • הושלמו {activeCourse.schedule.filter(s => s.completed).length}/{activeCourse.schedule.length}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={exportToCalendarTasks}
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium flex items-center gap-2 shadow-sm transition"
                >
                  <Download size={16} />
                  ייצא ליומן גוגל (.ics)
                </button>
                <button
                  onClick={openNewCourseForm}
                  className="px-4 py-2.5 rounded-xl bg-blue-600/10 text-blue-500 hover:bg-blue-600/20 text-sm font-semibold flex items-center gap-1.5 transition"
                >
                  <Plus size={16} />
                  קורס נוסף
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeCourse.schedule.map((session) => (
                <div
                  key={session.id}
                  className={`bg-white dark:bg-slate-900 p-5 rounded-2xl border transition flex items-center justify-between gap-3 ${
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
                      <p className="text-xs text-slate-400">{session.rationale}</p>
                    )}
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 pt-0.5">
                      <Clock size={14} />
                      <span>{session.duration} דקות למידה</span>
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
              <h3 className="text-lg font-bold">המרצה הקליני מייצר 8 כותרות מפורטות (10+ משפטים לכל כותרת)...</h3>
              <p className="text-sm text-slate-400">מכין סיכום עשיר, 10 כרטיסיות שינון ובוחן בן 10 שאלות עם ניתוח שגיאות</p>
            </div>
          ) : studyContent && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-2">
              <div className="lg:col-span-7 space-y-5">
                <div className="grid grid-cols-4 gap-2 bg-white dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-800">
                  {[
                    { id: 'learn', label: 'לימוד הפרק', icon: BookOpen },
                    { id: 'flashcards', label: `כרטיסיות (${studyContent.flashcards?.length || 10})`, icon: Layers },
                    { id: 'quiz', label: `בוחן (${studyContent.chapterQuiz?.length || 10})`, icon: Award },
                    { id: 'game', label: 'Code Blue', icon: Activity },
                  ].map((tab) => {
                    const Icon = tab.icon;
                    const active = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`py-2.5 px-3 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 transition ${
                          active
                            ? tab.id === 'game' ? 'bg-rose-600 text-white shadow-sm' : 'bg-blue-600 text-white shadow-sm'
                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <Icon size={16} />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>

                {activeTab === 'learn' && (
                  <>
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-6">
                      <div className="border-b border-slate-200 dark:border-slate-800 pb-4">
                        <span className="text-xs font-semibold text-blue-500">{activeCourse?.title} • שלב #{activeSession.id} • {activeSession.duration} דקות למידה</span>
                        <h2 className="text-2xl font-bold mt-1">{activeSession.topic}</h2>
                      </div>

                      <div className="space-y-6">
                        <h3 className="font-bold text-lg text-blue-500 border-b border-slate-100 dark:border-slate-800 pb-2">
                          📚 חומר לימוד מפורט (8 כותרות, 10+ משפטים בכל כותרת)
                        </h3>

                        {studyContent.sections?.map((sec, idx) => (
                          <div key={idx} className="space-y-2.5 p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80">
                            <h4 className="font-bold text-base text-blue-600 dark:text-blue-400 flex items-center gap-2">
                              <span className="bg-blue-600 text-white text-xs w-6 h-6 rounded-lg flex items-center justify-center shrink-0">{idx + 1}</span>
                              {sec.title}
                            </h4>
                            <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line">
                              {sec.content}
                            </p>
                          </div>
                        ))}
                      </div>

                      {studyContent.comparisonTable?.length > 0 && (
                        <div className="overflow-x-auto pt-4">
                          <h3 className="font-semibold text-base text-blue-500 mb-2">טבלת השוואה והערכה קלינית</h3>
                          <table className="w-full text-sm text-right border-collapse rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800">
                            <thead className="bg-slate-100 dark:bg-slate-800 text-xs uppercase">
                              <tr>
                                <th className="p-3">פרמטר</th>
                                <th className="p-3 text-blue-500">ממצא א׳</th>
                                <th className="p-3 text-amber-500">ממצא ב׳</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                              {studyContent.comparisonTable.map((row, i) => (
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

                    <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border-2 border-blue-500/30 space-y-4">
                      <div className="flex items-center gap-2 text-blue-500 font-bold">
                        <HelpCircle size={20} />
                        <h3>וידוא הבנה ראשוני (לסימון השלמת המשימה)</h3>
                      </div>
                      <p className="text-sm font-medium">{studyContent.comprehensionCheck.question}</p>

                      <div className="space-y-2">
                        {studyContent.comprehensionCheck.options.map((opt, idx) => {
                          const isSelected = selectedAnswer === idx;
                          const isCorrect = idx === studyContent.comprehensionCheck.correctIndex;
                          let btnStyle = 'border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800';
                          if (isSelected) {
                            btnStyle = isCorrect
                              ? 'bg-emerald-500/10 border-emerald-500 text-emerald-500 font-semibold'
                              : 'bg-red-500/10 border-red-500 text-red-500';
                          }
                          return (
                            <button
                              key={idx}
                              onClick={() => handleCheckUnderstanding(idx, studyContent.comprehensionCheck.correctIndex)}
                              className={`w-full text-right p-3.5 rounded-xl border text-sm transition flex items-center justify-between ${btnStyle}`}
                            >
                              <span>{opt}</span>
                              {isSelected && (isCorrect ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />)}
                            </button>
                          );
                        })}
                      </div>

                      {isQuizPassed && (
                        <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-500 text-sm font-medium flex items-center justify-between">
                          <span>מצוין! סשן זה סומן כהושלם. מומלץ לעבור לתרגול 10 הכרטיסיות ובוחן 10 השאלות.</span>
                          <button
                            onClick={() => setActiveTab('flashcards')}
                            className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700"
                          >
                            עבור לכרטיסיות
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {activeTab === 'flashcards' && (
                  <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-6">
                    <div className="flex justify-between items-center">
                      <h3 className="font-bold text-lg">כרטיסיות שינון (10 כרטיסיות) - {cardIndex + 1} / {studyContent.flashcards.length}</h3>
                      <span className="text-xs bg-emerald-500/10 text-emerald-500 px-3 py-1 rounded-full font-semibold">
                        נשלטות: {knownCards.length}/{studyContent.flashcards.length}
                      </span>
                    </div>

                    <div
                      onClick={() => setIsFlipped(!isFlipped)}
                      className="min-h-[260px] rounded-2xl border-2 border-blue-500/30 bg-slate-50 dark:bg-slate-950 p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:border-blue-500 transition select-none"
                    >
                      <span className="text-xs uppercase tracking-wider text-blue-500 font-bold mb-3">
                        {isFlipped ? 'הסבר קליני מלא' : 'מושג / מונח סיעודי (לחץ להיפוך)'}
                      </span>
                      <p className="text-lg font-semibold leading-relaxed">
                        {isFlipped ? studyContent.flashcards[cardIndex].back : studyContent.flashcards[cardIndex].front}
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
                          const currentId = studyContent.flashcards[cardIndex].id;
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
                )}

                {activeTab === 'quiz' && (
                  <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-6">
                    <div className="flex justify-between items-center">
                      <h3 className="font-bold text-lg">בוחן אמריקאי מסכם (10 שאלות): {activeSession.topic}</h3>
                      <button
                        onClick={regenerateNewQuiz}
                        disabled={isRegeneratingQuiz}
                        className="text-xs px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-500 font-semibold hover:bg-blue-500/20 flex items-center gap-1 transition"
                      >
                        <RotateCcw size={14} className={isRegeneratingQuiz ? 'animate-spin' : ''} />
                        צור 10 שאלות חדשות
                      </button>
                    </div>

                    {studyContent.chapterQuiz.map((item, qIdx) => (
                      <div key={qIdx} className="space-y-3 pb-5 border-b border-slate-200 dark:border-slate-800 last:border-0">
                        <p className="font-semibold text-sm">{qIdx + 1}. {item.q}</p>
                        <div className="space-y-1.5">
                          {item.opts.map((opt, oIdx) => {
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
                          <div className={`p-3.5 rounded-xl text-xs space-y-1 mt-2 ${
                            quizAnswers[qIdx] === item.ans 
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30' 
                              : 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/30'
                          }`}>
                            <p className="font-bold">
                              {quizAnswers[qIdx] === item.ans ? '✓ תשובה נכונה!' : '✗ טעות בתשובה.'}
                            </p>
                            <p className="leading-relaxed"><strong className="font-semibold">הסבר קליני:</strong> {item.explanation}</p>
                          </div>
                        )}
                      </div>
                    ))}

                    {!quizSubmitted ? (
                      <button
                        onClick={() => setQuizSubmitted(true)}
                        className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition shadow-lg shadow-blue-600/20"
                      >
                        הגש בוחן וקבל ניתוח שגיאות מלא (10 שאלות)
                      </button>
                    ) : (
                      <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30 flex justify-between items-center">
                        <span className="font-bold text-blue-500">
                          ציון: {studyContent.chapterQuiz.filter((q, i) => quizAnswers[i] === q.ans).length} מתוך {studyContent.chapterQuiz.length}
                        </span>
                        <button
                          onClick={() => { setQuizAnswers({}); setQuizSubmitted(false); }}
                          className="text-xs underline flex items-center gap-1 font-semibold"
                        >
                          <RotateCcw size={14} /> נסה שוב
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'game' && (
                  <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border-2 border-rose-500/40 space-y-6">
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
                          {studyContent.codeBlueCases[caseIndex].options.map((opt, idx) => (
                            <button
                              key={idx}
                              onClick={() => handleGameAnswer(idx, studyContent.codeBlueCases[caseIndex].correct, studyContent.codeBlueCases.length)}
                              className="w-full text-right p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-rose-500 hover:bg-rose-500/5 text-sm font-medium transition"
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="lg:col-span-5">
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col h-[620px] sticky top-24">
                  <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2.5">
                    <div className="bg-blue-600/10 text-blue-500 p-2 rounded-lg">
                      <MessageSquare size={18} />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm">מרצה קליני (AI Nursing Tutor)</h3>
                      <p className="text-xs text-slate-500">מבוסס על חומר הלימוד שלך</p>
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
                      placeholder="שאל שאלה קלינית על החומר..."
                      className="flex-1 bg-slate-100 dark:bg-slate-800 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
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
