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

// הגדרת Worker לקריאת PDF בדפדפן
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

// חילוץ טקסט אמיתי מכל סוגי הקבצים
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

// פונקציית עזר לדגימה חכמה שמכסה התחלה, אמצע וסוף של סשן ארוך בלי לאבד נושאים
function getSmartCoveredText(text, maxChars = 8500) {
  if (!text || text.length <= maxChars) return text;
  const partSize = Math.floor(maxChars / 3);
  const start = text.slice(0, partSize);
  const midStart = Math.floor(text.length / 2) - Math.floor(partSize / 2);
  const middle = text.slice(midStart, midStart + partSize);
  const end = text.slice(text.length - partSize);
  return `${start}\n\n[...המשך הפרק...]\n\n${middle}\n\n[...חלק אחרון של הפרק...]\n\n${end}`;
}

// 1. מנוע תכנון פדגוגי מהיר מבוסס AI (מחלק קבצים גדולים לתתי-פרקים כדי שלא יחסר חומר)
async function buildAISyllabusPlan(apiKey, files, totalSessionsCount, sessionDuration) {
  const filesCatalog = files.map((f, idx) => ({
    fileIndex: idx,
    fileName: f.name,
    wordCount: f.wordCount,
    excerpt: f.text.slice(0, 700)
  }));

  const prompt = `אתה מתכנן תוכניות לימוד ברפואה. סדר ${files.length} קבצים על פני בדיוק ${totalSessionsCount} סשנים של ${sessionDuration} דקות מהבסיס למתקדם (אנטומיה/פיזיולוגיה -> פתופיזיולוגיה -> קליניקה/טיפול).
אם קובץ ארוך (מעל 1,200 מילים), פצל אותו על פני מספר סשנים עוקבים בעזרת startPercent ו-endPercent כדי ששום חומר לא יידחס מדי.
החזר JSON תקין בלבד:
{
  "pedagogicalStrategy": "משפט אחד קצר על סדר הלימוד",
  "sessions": [
    {
      "sessionNumber": 1,
      "title": "כותרת ממוקדת לסשן",
      "fileIndex": 0,
      "startPercent": 0,
      "endPercent": 50,
      "rationale": "נימוק קצר עד 8 מילים"
    }
  ]
}
קבצים: ${JSON.stringify(filesCatalog)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      }
    );

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return JSON.parse(data.candidates[0].content.parts[0].text);
  } finally {
    clearTimeout(timeoutId);
  }
}

// 2. יצירת חומר לימוד מובנה המכסה את כל חלקי הסשן (התחלה, אמצע וסוף)
async function generateAIStudyMaterial(apiKey, topic, rawTextChunk) {
  const coveredText = getSmartCoveredText(rawTextChunk, 8500);

  const prompt = `מרצה לרפואה: בנה יחידת לימוד מקיפה אך תמציתית בעברית לנושא "${topic}" המכסה את כל חלקי הטקסט המצורף.
החזר JSON תקין בלבד:
{
  "summary": "סיכום קליני ברור המכסה את כל חלקי הטקסט (3-4 משפטים)",
  "keyPoints": ["נקודת מפתח מהחלק הראשון", "נקודת מפתח מהחלק האמצעי", "נקודת מפתח מהחלק האחרון", "נקודה קלינית נוספת"],
  "comparisonTable": [
    {"param": "פרמטר", "acute": "מאפיין א׳", "chronic": "מאפיין ב׳"}
  ],
  "comprehensionCheck": {
    "question": "שאלת הבנה קלינית",
    "options": ["תשובה נכונה", "מסיח 1", "מסיח 2"],
    "correctIndex": 0
  },
  "flashcards": [
    {"id": 1, "front": "מושג 1", "back": "הסבר קצר"},
    {"id": 2, "front": "מושג 2", "back": "הסבר קצר"},
    {"id": 3, "front": "מושג 3", "back": "הסבר קצר"},
    {"id": 4, "front": "מושג 4", "back": "הסבר קצר"}
  ],
  "chapterQuiz": [
    {"q": "שאלה 1", "opts": ["אפשרות 1", "אפשרות 2", "אפשרות 3"], "ans": 0},
    {"q": "שאלה 2", "opts": ["אפשרות 1", "אפשרות 2", "אפשרות 3"], "ans": 1},
    {"q": "שאלה 3", "opts": ["אפשרות 1", "אפשרות 2", "אפשרות 3"], "ans": 2}
  ],
  "codeBlueCases": [
    {"scenario": "מקרה קצר במיון", "question": "מה הפעולה הנכונה?", "options": ["פעולה נכונה", "טעות 1", "טעות 2"], "correct": 0},
    {"scenario": "המשך מקרה", "question": "איך תמשיך?", "options": ["אפשרות 1", "פעולה נכונה", "טעות 2"], "correct": 1}
  ]
}

טקסט:
${coveredText}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      }
    );

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const jsonText = data.candidates[0].content.parts[0].text;
    return JSON.parse(jsonText);
  } finally {
    clearTimeout(timeoutId);
  }
}
// נתוני גיבוי למקרה שלא הוזן מפתח API
const getFallbackContent = (topic) => ({
  summary: `מצב הדגמה עבור "${topic}". כדי שהמערכת תנתח את הטקסט האמיתי מהקבצים שהעלית, לחץ על כפתור ההגדרות למעלה והזן מפתח Gemini API חינמי.`,
  keyPoints: [
    'המערכת חילצה בהצלחה את הטקסט מהקבצים שהעלית.',
    'הזנת מפתח API תייצר כאן נקודות מפתח אמיתיות מתוך הסיכומים שלך.',
    'ניתן לשאול שאלות בצ׳אט המלווה משמאל בכל שלב.'
  ],
  comparisonTable: [
    { param: 'מצב נוכחי', acute: 'תצוגת הדגמה (Demo)', chronic: 'מצב AI מלא (עם מפתח API)' },
    { param: 'מקור המידע', acute: 'תבנית כללית', chronic: 'הקבצים האישיים שלך' }
  ],
  comprehensionCheck: {
    question: 'מה נדרש כדי להפעיל ניתוח AI מלא על הקבצים שהעלית?',
    options: ['הזנת מפתח API בהגדרות למעלה', 'הדפסת הקבצים', 'מחיקת הדפדפן'],
    correctIndex: 0
  },
  flashcards: [
    { id: 1, front: 'איך מפעילים AI אמיתי?', back: 'לוחצים על כפתור ההגדרות למעלה ומדביקים מפתח Google Gemini API.' },
    { id: 2, front: 'אילו קבצים נתמכים?', back: 'PDF, מצגות PPTX, מסמכי Word ו-TXT.' }
  ],
  chapterQuiz: [
    { q: 'האם הטקסט מהקובץ שלך נקרא בהצלחה?', opts: ['כן, מוכן לעיבוד!', 'לא'], ans: 0 }
  ],
  codeBlueCases: [
    {
      scenario: 'סטודנט לרפואה רוצה ללמוד למבחן ביעילות שיא לפני הדדליין.',
      question: 'מהי הפעולה המומלצת?',
      options: ['לעבוד לפי סשנים קבועים ולתרגל Active Recall', 'לדחות הכל ללילה שלפני'],
      correct: 0
    }
  ]
});

export default function App() {
  const [darkMode, setDarkMode] = useState(true);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('medstudy_api_key') || '');
  const [showSettings, setShowSettings] = useState(false);

  // רשימת כל הקורסים השמורים בדפדפן (כולל תוכן AI שנשמר לכל סשן)
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

  // שדות ליצירת קורס חדש
  const [courseName, setCourseName] = useState('');
  const [files, setFiles] = useState([]);
  const [isParsingFiles, setIsParsingFiles] = useState(false);
  const [deadline, setDeadline] = useState('');
  const [selectedDays, setSelectedDays] = useState([0, 2, 4]);
  const [sessionDuration, setSessionDuration] = useState(45);

  // מצב תכנון ובקרה של AI לפני אישור התוכנית
  const [isPlanningAI, setIsPlanningAI] = useState(false);
  const [draftPlan, setDraftPlan] = useState(null);

  // מצב למידה אקטיבי
  const [activeSession, setActiveSession] = useState(null);
  const [studyContent, setStudyContent] = useState(null);
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [activeTab, setActiveTab] = useState('learn');

  // מצב לימוד וצ'אט
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [isQuizPassed, setIsQuizPassed] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);

  // מצב כרטיסיות
  const [cardIndex, setCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [knownCards, setKnownCards] = useState([]);

  // מצב בוחן
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);

  // מצב משחק Code Blue
  const [gameStarted, setGameStarted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(60);
  const [caseIndex, setCaseIndex] = useState(0);
  const [patientStability, setPatientStability] = useState(100);
  const [streak, setStreak] = useState(0);
  const [gameOver, setGameOver] = useState(false);

  const activeCourse = courses.find((c) => c.id === activeCourseId) || null;

  // שמירה אוטומטית של כל הקורסים והתכנים בדפדפן
  useEffect(() => {
    try {
      localStorage.setItem('medstudy_courses', JSON.stringify(courses));
      if (activeCourseId) localStorage.setItem('medstudy_active_course', activeCourseId);
    } catch (e) {
      console.warn('חריגה מנפח האחסון המקומי בדפדפן');
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
    setSessionDuration(45);
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
            text: extractedText || 'לא נמצא טקסט קריא בקובץ זה.',
            wordCount: extractedText ? extractedText.split(/\s+/).length : 0
          };
        })
      );
      setFiles((prev) => [...prev, ...processed]);
    } catch (err) {
      alert('שגיאה בקריאת אחד הקבצים: ' + err.message);
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

  // בניית טיוטת תוכנית פדגוגית עם AI
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
      alert('לא נמצאו ימי לימוד תואמים בטווח התאריכים שנבחר.');
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
          const slice = targetFile.text.slice(startIdx, Math.max(endIdx, startIdx + 1500));

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
        alert('שגיאה בתכנון האוטומטי מול ה-AI: ' + err.message);
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
          rationale: 'חלוקה לינארית (חבר מפתח AI למעלה כדי לסדר פדגוגית מהבסיס לקליניקה)',
          textChunk: combinedText.slice(index * chunkSize, (index + 1) * chunkSize)
        };
      });

      setDraftPlan({
        strategy: 'חלוקה בסיסית לפי סדר הקבצים. מומלץ לחבר מפתח AI כדי לקבל סידור פדגוגי חכם.',
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
        savedContent: null // כאן יישמר חומר ה-AI לאחר הטעינה הראשונה
      };
    });

    const newCourse = {
      id: 'course-' + Date.now(),
      title: courseName.trim() || `קורס ${courses.length + 1} (${files[0].name.replace(/\.[^/.]+$/, "")})`,
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
      'PRODID:-//MedStudy AI//Study Tasks//HE',
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
        `SUMMARY:📚 [${activeCourse.title}] ${session.topic} (${session.duration} דק׳)`,
        `DESCRIPTION:${session.rationale || 'יעד למידה מתוך MedStudy AI'}.`,
        'END:VEVENT'
      );
    });

    icsContent.push('END:VCALENDAR');

    const blob = new Blob([icsContent.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `${activeCourse.title}_Tasks.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // התחלת סשן: טוען מהזיכרון ב-0 שניות אם כבר נוצר בעבר, או מייצר ושומר אוטומטית
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
        text: `היי! קראתי את החומר של "${session.topic}" מתוך הקורס "${activeCourse?.title}". אם משהו לא ברור או שתרצה דוגמה קלינית – פשוט שאל אותי כאן!`
      }
    ]);

    // אם התוכן כבר נוצר ונשמר בעבר -> הצג מיד ללא המתנה!
    if (session.savedContent) {
      setStudyContent(session.savedContent);
      return;
    }

    if (apiKey.trim()) {
      setIsLoadingAI(true);
      try {
        const aiData = await generateAIStudyMaterial(apiKey.trim(), session.topic, session.textChunk);
        setStudyContent(aiData);

        // שמירת התוכן שנוצר בתוך הקורס ב-localStorage לכניסות הבאות
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
        alert('שגיאה בחיבור ל-AI (בדוק שמפתח ה-API תקין או נסה שוב): ' + err.message);
        setStudyContent(getFallbackContent(session.topic));
      } finally {
        setIsLoadingAI(false);
      }
    } else {
      setStudyContent(getFallbackContent(session.topic));
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
          { role: 'ai', text: 'כדי שאוכל לענות תשובות אמיתיות מתוך הקבצים שלך, הזן מפתח Gemini API בהגדרות (כפתור ההגדרות למעלה).' }
        ]);
      }, 400);
      return;
    }

    setIsChatLoading(true);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey.trim()}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `אתה מורה פרטי לרפואה. ענה בעברית בצורה ברורה ותמציתית לשאלת הסטודנט על בסיס חומר הלימוד הבא:\n\nחומר הלימוד:\n${activeSession.textChunk.slice(0, 8000)}\n\nשאלת הסטודנט: ${userMsg}`
              }]
            }]
          })
        }
      );
      const data = await response.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'לא הצלחתי לנסח תשובה, נסה שוב.';
      setChatMessages((prev) => [...prev, { role: 'ai', text: reply }]);
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
            <h1 className="text-xl font-bold tracking-tight">MedStudy AI</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">מערכת למידה חכמה לסטודנטים לרפואה</p>
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
              apiKey 
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' 
                : 'border-amber-500/40 bg-amber-500/10 text-amber-500'
            }`}
            title="הגדרות AI"
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

      {/* חלונית הגדרות API Key */}
      {showSettings && (
        <div className="bg-slate-900 text-white border-b border-slate-800 px-6 py-4">
          <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-sm">
              <p className="font-bold flex items-center gap-1.5 text-blue-400">
                <Key size={16} /> חיבור מנוע Google Gemini AI (חינמי)
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                הדבק מפתח API מ-Google AI Studio כדי לנתח את הקבצים ולסדר אותם פדגוגית (נשמר מקומית בדפדפן שלך בלבד).
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
        {/* מסך 0: לוח הקורסים שלי */}
        {step === 0 && (
          <div className="space-y-6 mt-4">
            <div className="flex flex-wrap justify-between items-center gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800">
              <div>
                <h2 className="text-2xl font-bold">הקורסים שלי</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  נהל מספר קורסים במקביל, עקוב אחרי ההתקדמות בכל מקצוע או הוסף קורס חדש
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
                          title="מחק קורס"
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

        {/* מסך 1: העלאת קבצים והגדרת קורס */}
        {step === 1 && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-4">
            <div className="lg:col-span-6 space-y-6">
              <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
                  <Upload size={20} className="text-blue-500" />
                  1. העלאת חומרי לימוד לקורס
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                  העלה את כל המצגות והסיכומים – ה-AI יזהה לבד מה הבסיס ומה מתקדם ויסדר אותם בהתאם
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
                  <span className="text-xs text-slate-400 mt-1">קורא אוטומטית PDF, Word, מצגות וטקסט</span>
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
                    <h3 className="text-xs font-semibold uppercase text-slate-400">קבצים שנקראו בהצלחה ({files.length})</h3>
                    {files.map((file) => (
                      <div key={file.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <FileText size={18} className="text-blue-500 shrink-0" />
                          <div className="truncate">
                            <p className="text-sm font-medium truncate">{file.name}</p>
                            <p className="text-xs text-slate-500">{file.type} • {file.wordCount.toLocaleString()} מילים חולצו</p>
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
                    ה-AI יסרוק את כל הקבצים, יבנה סילבוס מהבסיס לקליניקה ויציג לך לבקרה לפני אישור
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">שם הקורס (למשל: קרדיולוגיה / פרמקולוגיה)</label>
                  <input
                    type="text"
                    value={courseName}
                    onChange={(e) => setCourseName(e.target.value)}
                    placeholder="הזן שם לקורס..."
                    className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">תאריך יעד (דדליין למבחן / סיום החומר)</label>
                  <input
                    type="date"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    באילו ימים בשבוע תרצה ללמוד קורס זה? ({selectedDays.length} פעמים בשבוע)
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
                      <span>ה-AI מנתח את הקבצים ומסדר מהבסיס לקליניקה...</span>
                    </>
                  ) : (
                    <>
                      <Brain size={20} />
                      <span>נתח חומר ובנה תוכנית חכמה לבקרה</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* מסך 1.5: בקרה ואישור תוכנית הלימודים */}
        {step === 1.5 && draftPlan && (
          <div className="space-y-6 mt-4 max-w-4xl mx-auto">
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border-2 border-blue-500/40 space-y-4">
              <div className="flex flex-wrap justify-between items-start gap-4">
                <div>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-500 flex items-center gap-1.5 w-fit">
                    <Brain size={14} /> בקרת תוכנית AI לפני אישור
                  </span>
                  <h2 className="text-2xl font-bold mt-2">סדר הלמידה המומלץ עבורך</h2>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setStep(1)}
                    className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    חזרה לעריכת קבצים
                  </button>
                  <button
                    onClick={generateAIDraftPlan}
                    disabled={isPlanningAI}
                    className="px-4 py-2.5 rounded-xl border border-blue-500/40 text-blue-500 text-sm font-semibold hover:bg-blue-500/10 flex items-center gap-1.5"
                  >
                    <RotateCcw size={16} className={isPlanningAI ? 'animate-spin' : ''} />
                    תכנן מחדש עם AI
                  </button>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/20 text-sm text-slate-700 dark:text-slate-300">
                <strong className="text-blue-500 block mb-1">היגיון פדגוגי שנבחר לקורס:</strong>
                {draftPlan.strategy}
              </div>

              <p className="text-xs text-slate-500">
                בדוק את סדר הנושאים למטה. תוכל להזיז סשנים למעלה/למטה או לערוך כותרות לפני שאתה מאשר סופית:
              </p>

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
                        title="הקדם סשן"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        onClick={() => moveDraftSession(idx, 1)}
                        disabled={idx === draftPlan.sessions.length - 1}
                        className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-30"
                        title="דחה סשן"
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

        {/* מסך 2: לוח זמנים של קורס ספציפי */}
        {step === 2 && activeCourse && (
          <div className="space-y-6 mt-4">
            <div className="flex flex-wrap justify-between items-center gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800">
              <div className="space-y-1 max-w-2xl">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold px-2.5 py-0.5 rounded-md bg-blue-500/10 text-blue-500">קורס פעיל</span>
                  <h2 className="text-xl font-bold">{activeCourse.title}</h2>
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {activeCourse.schedule.length} משימות למידה של {activeCourse.sessionDuration} דקות • הושלמו {activeCourse.schedule.filter(s => s.completed).length}/{activeCourse.schedule.length}
                </p>
                {activeCourse.strategy && (
                  <p className="text-xs text-blue-500/90 pt-1">{activeCourse.strategy}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={exportToCalendarTasks}
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium flex items-center gap-2 shadow-sm transition"
                >
                  <Download size={16} />
                  הכנס משימות ליומן גוגל (.ics)
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
                    session.completed 
                      ? 'border-emerald-500/50 bg-emerald-500/5' 
                      : 'border-slate-200 dark:border-slate-800 hover:border-blue-500/50'
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
                      {session.savedContent && !session.completed && (
                        <span className="text-amber-500 text-[11px] font-semibold">• מוכן בזיכרון</span>
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

        {/* מסך 3: חדר למידה אינטראקטיבי */}
        {step === 3 && activeSession && (
          isLoadingAI ? (
            <div className="flex flex-col items-center justify-center py-24 space-y-4">
              <Loader2 size={44} className="text-blue-500 animate-spin" />
              <h3 className="text-lg font-bold">המרצה הדיגיטלי קורא את החומר...</h3>
              <p className="text-sm text-slate-400">מכין סיכום קליני, כרטיסיות, בוחן ומקרי חירום (יישמר בזיכרון לכניסות הבאות)</p>
            </div>
          ) : studyContent && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-2">
              <div className="lg:col-span-7 space-y-5">
                <div className="grid grid-cols-4 gap-2 bg-white dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-800">
                  {[
                    { id: 'learn', label: 'לימוד הפרק', icon: BookOpen },
                    { id: 'flashcards', label: 'כרטיסיות', icon: Layers },
                    { id: 'quiz', label: 'בוחן פרק', icon: Award },
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
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-5">
                      <div className="border-b border-slate-200 dark:border-slate-800 pb-4">
                        <span className="text-xs font-semibold text-blue-500">{activeCourse?.title} • שלב #{activeSession.id} • {activeSession.duration} דקות</span>
                        <h2 className="text-2xl font-bold mt-1">{activeSession.topic}</h2>
                      </div>

                      <div className="space-y-2">
                        <h3 className="font-semibold text-base text-blue-500">סקירה קלינית ותקציר הפרק</h3>
                        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{studyContent.summary}</p>
                      </div>

                      <div className="space-y-2">
                        <h3 className="font-semibold text-base text-blue-500">נקודות מפתח למבחן</h3>
                        <ul className="space-y-2">
                          {studyContent.keyPoints.map((pt, i) => (
                            <li key={i} className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300">
                              <span className="bg-blue-500/10 text-blue-500 font-bold px-2 py-0.5 rounded text-xs mt-0.5">{i + 1}</span>
                              <span>{pt}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      {studyContent.comparisonTable?.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm text-right border-collapse rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800">
                            <thead className="bg-slate-100 dark:bg-slate-800 text-xs uppercase">
                              <tr>
                                <th className="p-3">פרמטר</th>
                                <th className="p-3 text-blue-500">היבט א׳</th>
                                <th className="p-3 text-amber-500">היבט ב׳</th>
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
                        <h3>וידוא הבנה (חובה להשלמת המשימה)</h3>
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
                          <span>מצוין! המשימה סומנה כהושלמה.</span>
                          <button
                            onClick={() => setActiveTab('flashcards')}
                            className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700"
                          >
                            המשך לכרטיסיות למידה
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {activeTab === 'flashcards' && (
                  <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-6">
                    <div className="flex justify-between items-center">
                      <h3 className="font-bold text-lg">כרטיסיות שינון ({cardIndex + 1} מתוך {studyContent.flashcards.length})</h3>
                      <span className="text-xs bg-emerald-500/10 text-emerald-500 px-3 py-1 rounded-full font-semibold">
                        נשלטות: {knownCards.length}/{studyContent.flashcards.length}
                      </span>
                    </div>

                    <div
                      onClick={() => setIsFlipped(!isFlipped)}
                      className="min-h-[240px] rounded-2xl border-2 border-blue-500/30 bg-slate-50 dark:bg-slate-950 p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:border-blue-500 transition select-none"
                    >
                      <span className="text-xs uppercase tracking-wider text-blue-500 font-bold mb-3">
                        {isFlipped ? 'הסבר / תשובה' : 'שאלה / מושג (לחץ להיפוך)'}
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
                        לחזור על זה שוב
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
                        יודע מצוין ✓
                      </button>
                    </div>
                  </div>
                )}

                {activeTab === 'quiz' && (
                  <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-6">
                    <h3 className="font-bold text-lg">בוחן סוף פרק: {activeSession.topic}</h3>
                    {studyContent.chapterQuiz.map((item, qIdx) => (
                      <div key={qIdx} className="space-y-2.5 pb-4 border-b border-slate-200 dark:border-slate-800 last:border-0">
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
                      </div>
                    ))}

                    {!quizSubmitted ? (
                      <button
                        onClick={() => setQuizSubmitted(true)}
                        className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition"
                      >
                        הגש בוחן לבדיקה
                      </button>
                    ) : (
                      <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30 flex justify-between items-center">
                        <span className="font-bold text-blue-500">
                          ציון: {studyContent.chapterQuiz.filter((q, i) => quizAnswers[i] === q.ans).length} מתוך {studyContent.chapterQuiz.length}
                        </span>
                        <button
                          onClick={() => { setQuizAnswers({}); setQuizSubmitted(false); }}
                          className="text-xs underline flex items-center gap-1"
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
                        <h3 className="text-2xl font-bold">Code Blue: אבחנה תחת לחץ</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                          יש לך 60 שניות לקבל החלטות קליניות מדויקות מתוך החומר של הפרק ולייצב את המטופל!
                        </p>
                        <button
                          onClick={startCodeBlueGame}
                          className="px-8 py-3.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-lg shadow-rose-600/20 transition"
                        >
                          התחל משמרת במיון 🚑
                        </button>
                      </div>
                    ) : gameOver ? (
                      <div className="text-center py-8 space-y-4">
                        <h3 className="text-2xl font-bold">
                          {patientStability > 0 ? 'המטופל יוצב בהצלחה! 🎉' : 'המטופל איבד יציבות ⚠️'}
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
                            יציבות: <span className={patientStability > 50 ? 'text-emerald-500' : 'text-rose-500'}>{patientStability}%</span>
                          </div>
                        </div>

                        <div className="p-4 rounded-xl bg-rose-500/5 border border-rose-500/20 space-y-2">
                          <span className="text-xs font-bold text-rose-500 uppercase">מקרה קליני #{caseIndex + 1}</span>
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
                      <h3 className="font-bold text-sm">צ'אט מורה פרטי (AI Tutor)</h3>
                      <p className="text-xs text-slate-500">מבוסס על הטקסט מהקבצים שלך</p>
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
                      placeholder="משהו לא ברור? שאל כאן..."
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
