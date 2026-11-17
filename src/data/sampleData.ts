import type {
  ALevelPolicyConfig,
  CbcConfig,
  ExaminationPeriod,
  GradeBand,
  MarkEntryItem,
  MarksheetRecord,
  ReportCardLayoutConfig,
  SchoolDatabase,
  SchoolSettings,
  StreamClass,
  StudentProfile,
  SubjectCombination,
  SubjectDefinition,
  UserAccount,
} from '../types';

export const DEFAULT_CBC_CONFIG: CbcConfig = {
  aoiMaxMark: 3,
  eotMaxMark: 100,
  formativeWeight: 20,
  summativeWeight: 80,
  roundingMode: 'one_decimal',
  aoiInputMode: 'u1_u3',
};

export const DEFAULT_ALEVEL_POLICY: ALevelPolicyConfig = {
  maxPrincipalsCount: 3,
  maxSubsidiariesCount: 2,
  subsidiaryPassMark: 50,
  includeSubsidiaryPoints: true,
};

export const DEFAULT_OLEVEL_GRADING_SCALE: GradeBand[] = [
  {
    grade: 'A',
    minPercentage: 80,
    label: 'Exceptional',
    gpa: 4.0,
    description: 'Demonstrates extraordinary competency',
  },
  {
    grade: 'B',
    minPercentage: 70,
    label: 'Outstanding',
    gpa: 3.5,
    description: 'Demonstrates high level of competency',
  },
  {
    grade: 'C',
    minPercentage: 60,
    label: 'Satisfactory',
    gpa: 3.0,
    description: 'Demonstrates adequate competency',
  },
  {
    grade: 'D',
    minPercentage: 50,
    label: 'Basic',
    gpa: 2.0,
    description: 'Demonstrates minimum competency',
  },
  {
    grade: 'E',
    minPercentage: 0,
    label: 'Elementary',
    gpa: 1.0,
    description: 'Requires guided support',
  },
];

export const DEFAULT_ALEVEL_GRADING_SCALE: GradeBand[] = [
  { grade: 'A', minPercentage: 80, label: 'Distinction', gpa: 6, description: 'Principal Pass (6 pts)' },
  { grade: 'B', minPercentage: 70, label: 'Very Good', gpa: 5, description: 'Principal Pass (5 pts)' },
  { grade: 'C', minPercentage: 60, label: 'Credit', gpa: 4, description: 'Principal Pass (4 pts)' },
  { grade: 'D', minPercentage: 50, label: 'Credit', gpa: 3, description: 'Principal Pass (3 pts)' },
  { grade: 'E', minPercentage: 45, label: 'Pass', gpa: 2, description: 'Principal Pass (2 pts)' },
  { grade: 'O', minPercentage: 35, label: 'Subsidiary', gpa: 1, description: 'Subsidiary Pass (1 pt)' },
  { grade: 'F', minPercentage: 0, label: 'Fail', gpa: 0, description: 'Unclassified (0 pts)' },
];

export const DEFAULT_REPORT_CARD_LAYOUT: ReportCardLayoutConfig = {
  style: 'classic',
  accentColor: 'navy',
  headerAlignment: 'split',
  crestType: 'shield',
  reportTitle: 'Official Terminal Academic Report',
  schoolMotto: 'Strive for Excellence & Integrity',
  schoolContact: 'P.O. Box 14280 Kampala · Plot 28 Kira-Ntinda Road · +256 414 550 812',
  showStudentPhoto: true,
  showSubjectCode: true,
  showPassMark: true,
  showClassAverage: true,
  showSubjectRank: false,
  showSubjectTeacher: true,
  showClassPosition: true,
  showOverallSummaryStrip: true,
  showPerformanceChart: true,
  showGradingKey: true,
  showCompetenciesSection: true,
  showDosComment: true,
  showParentSignature: true,
  showSchoolStampBox: true,
  showNextTermDate: true,
  nextTermClosingDate: '2026-12-04',
  nextTermDate: '2027-02-01',
  leftSignatureLabel: 'Class Teacher Signature',
  rightSignatureLabel: 'Headteacher Signature',
  parentSignatureLabel: 'Parent / Guardian Signature',
  footerNote: 'Official school record · Valid only with authentic school stamp and authorized signatures.',
};

export const DEFAULT_SCHOOL_SETTINGS: SchoolSettings = {
  schoolName: 'Kampala Horizon High School',
  schoolAddress: 'Plot 28 Kira-Ntinda Road, Kampala, Uganda',
  schoolPhone: '+256 414 550 812',
  schoolEmail: 'dos@kampalahorizon.ac.ug',
  academicYear: '2026',
  termName: 'Term III',
  principalName: 'Mr. Godfrey Ssemakula',
  dosName: 'Mrs. Grace Nakimuli',
  cbcConfig: DEFAULT_CBC_CONFIG,
  alevelPolicy: DEFAULT_ALEVEL_POLICY,
  olevelGradingScale: DEFAULT_OLEVEL_GRADING_SCALE,
  alevelGradingScale: DEFAULT_ALEVEL_GRADING_SCALE,
  reportLayout: DEFAULT_REPORT_CARD_LAYOUT,
};

const SEED_USERS: UserAccount[] = [
  {
    id: 'usr-admin',
    name: 'Eng. Ronald Kiggundu',
    email: 'admin@kampalahorizon.ac.ug',
    username: 'admin',
    password: 'password123',
    role: 'school_admin',
    active: true,
    phone: '+256 772 110 401',
    assignedClassIds: [],
    assignedSubjectIds: [],
    lastLogin: '2026-11-15T07:45:00Z',
  },
  {
    id: 'usr-dos',
    name: 'Mrs. Grace Nakimuli',
    email: 'dos@kampalahorizon.ac.ug',
    username: 'dos',
    password: 'password123',
    role: 'dos',
    active: true,
    phone: '+256 701 348 220',
    assignedClassIds: ['cls-s2-east', 'cls-s3-west', 'cls-s5-sci', 'cls-s6-arts'],
    assignedSubjectIds: [],
    lastLogin: '2026-11-15T08:10:00Z',
  },
  {
    id: 'usr-teacher-math',
    name: 'Mr. Brian Ssebunya',
    email: 'bssebunya@kampalahorizon.ac.ug',
    username: 'teacher',
    password: 'password123',
    role: 'teacher',
    active: true,
    phone: '+256 774 881 902',
    assignedClassIds: ['cls-s2-east', 'cls-s3-west', 'cls-s5-sci'],
    assignedSubjectIds: ['sub-o-math', 'sub-o-phys', 'sub-a-math', 'sub-a-phys'],
    lastLogin: '2026-11-15T08:30:00Z',
  },
  {
    id: 'usr-teacher-hum',
    name: 'Ms. Justine Nabwire',
    email: 'jnabwire@kampalahorizon.ac.ug',
    username: 'jnabwire',
    password: 'password123',
    role: 'teacher',
    active: true,
    phone: '+256 752 612 409',
    assignedClassIds: ['cls-s2-east', 'cls-s3-west', 'cls-s6-arts'],
    assignedSubjectIds: ['sub-o-engl', 'sub-o-hist', 'sub-a-gp', 'sub-a-hist'],
    lastLogin: '2026-11-14T16:12:00Z',
  },
  {
    id: 'usr-teacher-sci',
    name: 'Dr. Emmanuel Okello',
    email: 'eokello@kampalahorizon.ac.ug',
    username: 'eokello',
    password: 'password123',
    role: 'teacher',
    active: true,
    phone: '+256 782 409 773',
    assignedClassIds: ['cls-s2-east', 'cls-s3-west', 'cls-s5-sci'],
    assignedSubjectIds: ['sub-o-biol', 'sub-o-chem', 'sub-o-ict', 'sub-a-chem', 'sub-a-bio', 'sub-a-sict'],
    lastLogin: '2026-11-14T15:05:00Z',
  },
  {
    id: 'usr-head',
    name: 'Mr. Godfrey Ssemakula',
    email: 'headteacher@kampalahorizon.ac.ug',
    username: 'headteacher',
    password: 'password123',
    role: 'headteacher',
    active: true,
    phone: '+256 772 900 100',
    assignedClassIds: ['cls-s2-east', 'cls-s3-west', 'cls-s5-sci', 'cls-s6-arts'],
    assignedSubjectIds: [],
    lastLogin: '2026-11-15T07:55:00Z',
  },
  {
    id: 'usr-bursar',
    name: 'Ms. Harriet Namukasa',
    email: 'bursar@kampalahorizon.ac.ug',
    username: 'bursar',
    password: 'password123',
    role: 'bursar',
    active: true,
    phone: '+256 772 514 902',
    assignedClassIds: [],
    assignedSubjectIds: [],
    lastLogin: '2026-11-15T08:05:00Z',
  },
];

const SEED_SUBJECTS: SubjectDefinition[] = [
  // O'Level CBC Subjects
  {
    id: 'sub-o-math',
    code: 'MATH',
    name: 'Mathematics',
    level: 'olevel',
    category: 'compulsory',
    maxMarks: 100,
    passMark: 50,
    competencies: [
      'Applies algebraic and geometric reasoning to everyday problem solving',
      'Interprets statistical charts, ratios, and numerical patterns accurately',
    ],
  },
  {
    id: 'sub-o-engl',
    code: 'ENGL',
    name: 'English Language',
    level: 'olevel',
    category: 'compulsory',
    maxMarks: 100,
    passMark: 50,
    competencies: [
      'Communicates ideas clearly in structured written compositions and summaries',
      'Demonstrates comprehension and critical analysis of formal texts',
    ],
  },
  {
    id: 'sub-o-biol',
    code: 'BIOL',
    name: 'Biology',
    level: 'olevel',
    category: 'compulsory',
    maxMarks: 100,
    passMark: 50,
    competencies: [
      'Conducts biological investigations and records observations systematically',
      'Explains cellular processes, human health, and ecological balance',
    ],
  },
  {
    id: 'sub-o-chem',
    code: 'CHEM',
    name: 'Chemistry',
    level: 'olevel',
    category: 'compulsory',
    maxMarks: 100,
    passMark: 50,
    competencies: [
      'Applies chemical equations and laboratory safety in practical tasks',
      'Analyses properties of matter, acids, bases, and chemical reactions',
    ],
  },
  {
    id: 'sub-o-phys',
    code: 'PHYS',
    name: 'Physics',
    level: 'olevel',
    category: 'compulsory',
    maxMarks: 100,
    passMark: 50,
    competencies: [
      'Uses measurement instruments accurately to investigate mechanics and energy',
      'Applies scientific laws to real-world technological contexts',
    ],
  },
  {
    id: 'sub-o-hist',
    code: 'HIST',
    name: 'History & Political Ed',
    level: 'olevel',
    category: 'compulsory',
    maxMarks: 100,
    passMark: 50,
    competencies: [
      'Evaluates East African historical developments and civic institutions',
    ],
  },
  {
    id: 'sub-o-geog',
    code: 'GEOG',
    name: 'Geography',
    level: 'olevel',
    category: 'compulsory',
    maxMarks: 100,
    passMark: 50,
    competencies: [
      'Interprets topographic maps, fieldwork findings, and climate data',
    ],
  },
  {
    id: 'sub-o-ict',
    code: 'ICT',
    name: 'Information & Comm. Tech',
    level: 'olevel',
    category: 'elective',
    maxMarks: 100,
    passMark: 50,
    competencies: [
      'Uses productivity suites and spreadsheets responsibly for digital problem solving',
    ],
  },
  {
    id: 'sub-o-entr',
    code: 'ENTR',
    name: 'Entrepreneurship',
    level: 'olevel',
    category: 'elective',
    maxMarks: 100,
    passMark: 50,
    competencies: [
      'Designs viable small-business budgets and market opportunity plans',
    ],
  },

  // A'Level Principal & Subsidiary Subjects
  {
    id: 'sub-a-math',
    code: 'P425',
    name: 'Principal Mathematics',
    level: 'alevel',
    category: 'principal',
    maxMarks: 100,
    passMark: 45,
    competencies: ['Pure Mathematics, Mechanics & Probability/Statistics'],
  },
  {
    id: 'sub-a-phys',
    code: 'P510',
    name: 'Physics',
    level: 'alevel',
    category: 'principal',
    maxMarks: 100,
    passMark: 45,
    competencies: ['Mechanics, Heat, Optics, Electricity & Modern Physics'],
  },
  {
    id: 'sub-a-chem',
    code: 'P525',
    name: 'Chemistry',
    level: 'alevel',
    category: 'principal',
    maxMarks: 100,
    passMark: 45,
    competencies: ['Physical, Inorganic & Organic Chemistry'],
  },
  {
    id: 'sub-a-bio',
    code: 'P530',
    name: 'Biology',
    level: 'alevel',
    category: 'principal',
    maxMarks: 100,
    passMark: 45,
    competencies: ['Cytology, Genetics, Physiology & Ecology'],
  },
  {
    id: 'sub-a-econ',
    code: 'P220',
    name: 'Economics',
    level: 'alevel',
    category: 'principal',
    maxMarks: 100,
    passMark: 45,
    competencies: ['Microeconomics, Macroeconomics & Development Policy'],
  },
  {
    id: 'sub-a-hist',
    code: 'P210',
    name: 'History',
    level: 'alevel',
    category: 'principal',
    maxMarks: 100,
    passMark: 45,
    competencies: ['African Nationalism & World Affairs'],
  },
  {
    id: 'sub-a-geog',
    code: 'P250',
    name: 'Geography',
    level: 'alevel',
    category: 'principal',
    maxMarks: 100,
    passMark: 45,
    competencies: ['Physical Geography, Human Development & Fieldwork'],
  },
  {
    id: 'sub-a-gp',
    code: 'S101',
    name: 'General Paper',
    level: 'alevel',
    category: 'subsidiary',
    maxMarks: 100,
    passMark: 50,
    competencies: ['Critical Essay Writing & Logic Comprehension'],
  },
  {
    id: 'sub-a-sict',
    code: 'S850',
    name: 'Subsidiary ICT',
    level: 'alevel',
    category: 'subsidiary',
    maxMarks: 100,
    passMark: 50,
    competencies: ['Applied Computing, Databases & Web Fundamentals'],
  },
  {
    id: 'sub-a-smath',
    code: 'S475',
    name: 'Subsidiary Mathematics',
    level: 'alevel',
    category: 'subsidiary',
    maxMarks: 100,
    passMark: 50,
    competencies: ['Applied Algebra, Calculus & Statistics'],
  },
];

const SEED_COMBINATIONS: SubjectCombination[] = [
  {
    id: 'comb-pcm',
    code: 'PCM/ICT',
    name: 'Physics, Chemistry, Mathematics + Sub-ICT & GP',
    principalSubjectIds: ['sub-a-phys', 'sub-a-chem', 'sub-a-math'],
    subsidiarySubjectIds: ['sub-a-gp', 'sub-a-sict'],
  },
  {
    id: 'comb-bcm',
    code: 'BCM/ICT',
    name: 'Biology, Chemistry, Mathematics + Sub-ICT & GP',
    principalSubjectIds: ['sub-a-bio', 'sub-a-chem', 'sub-a-math'],
    subsidiarySubjectIds: ['sub-a-gp', 'sub-a-sict'],
  },
  {
    id: 'comb-heg',
    code: 'HEG/SM',
    name: 'History, Economics, Geography + Sub-Math & GP',
    principalSubjectIds: ['sub-a-hist', 'sub-a-econ', 'sub-a-geog'],
    subsidiarySubjectIds: ['sub-a-gp', 'sub-a-smath'],
  },
];

const SEED_CLASSES: StreamClass[] = [
  {
    id: 'cls-s2-east',
    name: 'S.2 East',
    gradeLevel: 'S.2',
    stream: 'East',
    level: 'olevel',
    classTeacherId: 'usr-teacher-hum',
    subjectIds: ['sub-o-math', 'sub-o-engl', 'sub-o-biol', 'sub-o-chem', 'sub-o-geog', 'sub-o-ict'],
    subjectTeacherMap: {
      'sub-o-math': 'usr-teacher-math',
      'sub-o-engl': 'usr-teacher-hum',
      'sub-o-biol': 'usr-teacher-sci',
      'sub-o-chem': 'usr-teacher-sci',
      'sub-o-geog': 'usr-teacher-hum',
      'sub-o-ict': 'usr-teacher-sci',
    },
  },
  {
    id: 'cls-s3-west',
    name: 'S.3 West',
    gradeLevel: 'S.3',
    stream: 'West',
    level: 'olevel',
    classTeacherId: 'usr-teacher-math',
    subjectIds: ['sub-o-math', 'sub-o-engl', 'sub-o-phys', 'sub-o-hist', 'sub-o-entr'],
    subjectTeacherMap: {
      'sub-o-math': 'usr-teacher-math',
      'sub-o-engl': 'usr-teacher-hum',
      'sub-o-phys': 'usr-teacher-math',
      'sub-o-hist': 'usr-teacher-hum',
      'sub-o-entr': 'usr-dos',
    },
  },
  {
    id: 'cls-s5-sci',
    name: 'S.5 Science',
    gradeLevel: 'S.5',
    stream: 'Science',
    level: 'alevel',
    classTeacherId: 'usr-teacher-sci',
    subjectIds: ['sub-a-math', 'sub-a-phys', 'sub-a-chem', 'sub-a-gp', 'sub-a-sict'],
    subjectTeacherMap: {
      'sub-a-math': 'usr-teacher-math',
      'sub-a-phys': 'usr-teacher-math',
      'sub-a-chem': 'usr-teacher-sci',
      'sub-a-gp': 'usr-teacher-hum',
      'sub-a-sict': 'usr-teacher-sci',
    },
  },
  {
    id: 'cls-s6-arts',
    name: 'S.6 Arts',
    gradeLevel: 'S.6',
    stream: 'Arts',
    level: 'alevel',
    classTeacherId: 'usr-teacher-hum',
    subjectIds: ['sub-a-hist', 'sub-a-econ', 'sub-a-geog', 'sub-a-gp', 'sub-a-smath'],
    subjectTeacherMap: {
      'sub-a-hist': 'usr-teacher-hum',
      'sub-a-econ': 'usr-dos',
      'sub-a-geog': 'usr-teacher-hum',
      'sub-a-gp': 'usr-teacher-hum',
      'sub-a-smath': 'usr-teacher-math',
    },
  },
];

const SEED_STUDENTS: StudentProfile[] = [
  // S.2 East (10 students)
  { id: 'stu-s2-01', admissionNo: 'KHHS/26/201', fullName: 'Namukasa Sarah', gender: 'F', dateOfBirth: '2011-03-14', classId: 'cls-s2-east', academicYear: '2026', status: 'active', parentName: 'Mrs. Rebecca Namukasa', parentContact: '+256 772 301 112' },
  { id: 'stu-s2-02', admissionNo: 'KHHS/26/202', fullName: 'Ssempijja Daniel', gender: 'M', dateOfBirth: '2011-06-22', classId: 'cls-s2-east', academicYear: '2026', status: 'active', parentName: 'Mr. Paul Ssempijja', parentContact: '+256 701 442 890' },
  { id: 'stu-s2-03', admissionNo: 'KHHS/26/203', fullName: 'Achieng Grace', gender: 'F', dateOfBirth: '2011-01-09', classId: 'cls-s2-east', academicYear: '2026', status: 'active', parentName: 'Mr. Francis Ochieng', parentContact: '+256 782 990 314' },
  { id: 'stu-s2-04', admissionNo: 'KHHS/26/204', fullName: 'Tumusiime Ivan', gender: 'M', dateOfBirth: '2010-11-18', classId: 'cls-s2-east', academicYear: '2026', status: 'active', parentName: 'Mrs. Sylvia Tumusiime', parentContact: '+256 752 813 400' },
  { id: 'stu-s2-05', admissionNo: 'KHHS/26/205', fullName: 'Nakato Brenda', gender: 'F', dateOfBirth: '2011-05-30', classId: 'cls-s2-east', academicYear: '2026', status: 'active', parentName: 'Mr. John Kizza', parentContact: '+256 774 221 678' },
  { id: 'stu-s2-06', admissionNo: 'KHHS/26/206', fullName: 'Mugisha Trevor', gender: 'M', dateOfBirth: '2011-08-04', classId: 'cls-s2-east', academicYear: '2026', status: 'active', parentName: 'Mrs. Harriet Mugisha', parentContact: '+256 704 118 552' },
  { id: 'stu-s2-07', admissionNo: 'KHHS/26/207', fullName: 'Byaruhanga Miriam', gender: 'F', dateOfBirth: '2011-02-17', classId: 'cls-s2-east', academicYear: '2026', status: 'active', parentName: 'Dr. Patrick Byaruhanga', parentContact: '+256 772 650 321' },
  { id: 'stu-s2-08', admissionNo: 'KHHS/26/208', fullName: 'Wasswa Timothy', gender: 'M', dateOfBirth: '2011-05-30', classId: 'cls-s2-east', academicYear: '2026', status: 'active', parentName: 'Mr. John Kizza', parentContact: '+256 774 221 678' },
  { id: 'stu-s2-09', admissionNo: 'KHHS/26/209', fullName: 'Birungi Esther', gender: 'F', dateOfBirth: '2011-09-12', classId: 'cls-s2-east', academicYear: '2026', status: 'active', parentName: 'Mrs. Peace Birungi', parentContact: '+256 781 404 991' },
  { id: 'stu-s2-10', admissionNo: 'KHHS/26/210', fullName: 'Okot Emmanuel', gender: 'M', dateOfBirth: '2010-12-03', classId: 'cls-s2-east', academicYear: '2026', status: 'active', parentName: 'Mr. Moses Okot', parentContact: '+256 776 319 005' },

  // S.3 West (6 students)
  { id: 'stu-s3-01', admissionNo: 'KHHS/25/301', fullName: 'Kato Samuel', gender: 'M', dateOfBirth: '2010-04-11', classId: 'cls-s3-west', academicYear: '2026', status: 'active', parentName: 'Mr. George Kato', parentContact: '+256 772 710 443' },
  { id: 'stu-s3-02', admissionNo: 'KHHS/25/302', fullName: 'Nabulya Faith', gender: 'F', dateOfBirth: '2010-07-19', classId: 'cls-s3-west', academicYear: '2026', status: 'active', parentName: 'Mrs. Prossy Nabulya', parentContact: '+256 701 882 340' },
  { id: 'stu-s3-03', admissionNo: 'KHHS/25/303', fullName: 'Opio Brian', gender: 'M', dateOfBirth: '2010-02-26', classId: 'cls-s3-west', academicYear: '2026', status: 'active', parentName: 'Mr. Andrew Opio', parentContact: '+256 782 553 118' },
  { id: 'stu-s3-04', admissionNo: 'KHHS/25/304', fullName: 'Akello Judith', gender: 'F', dateOfBirth: '2010-10-08', classId: 'cls-s3-west', academicYear: '2026', status: 'active', parentName: 'Mrs. Beatrice Akello', parentContact: '+256 753 200 719' },
  { id: 'stu-s3-05', admissionNo: 'KHHS/25/305', fullName: 'Muwonge Jonathan', gender: 'M', dateOfBirth: '2009-12-20', classId: 'cls-s3-west', academicYear: '2026', status: 'active', parentName: 'Mr. Henry Muwonge', parentContact: '+256 775 411 820' },
  { id: 'stu-s3-06', admissionNo: 'KHHS/25/306', fullName: 'Nansubuga Gloria', gender: 'F', dateOfBirth: '2010-05-15', classId: 'cls-s3-west', academicYear: '2026', status: 'active', parentName: 'Mrs. Agnes Nansubuga', parentContact: '+256 702 661 904' },

  // S.5 Science (8 students)
  { id: 'stu-s5-01', admissionNo: 'KHHS/26/501', fullName: 'Kabanda Marvin', gender: 'M', dateOfBirth: '2008-03-08', classId: 'cls-s5-sci', academicYear: '2026', status: 'active', combinationId: 'comb-pcm', parentName: 'Eng. Peter Kabanda', parentContact: '+256 772 800 512' },
  { id: 'stu-s5-02', admissionNo: 'KHHS/26/502', fullName: 'Nalwoga Patricia', gender: 'F', dateOfBirth: '2008-06-14', classId: 'cls-s5-sci', academicYear: '2026', status: 'active', combinationId: 'comb-pcm', parentName: 'Mrs. Joan Nalwoga', parentContact: '+256 701 992 103' },
  { id: 'stu-s5-03', admissionNo: 'KHHS/26/503', fullName: 'Kibombo Allan', gender: 'M', dateOfBirth: '2008-01-25', classId: 'cls-s5-sci', academicYear: '2026', status: 'active', combinationId: 'comb-pcm', parentName: 'Mr. Charles Kibombo', parentContact: '+256 782 140 776' },
  { id: 'stu-s5-04', admissionNo: 'KHHS/26/504', fullName: 'Atuhaire Sandra', gender: 'F', dateOfBirth: '2008-09-02', classId: 'cls-s5-sci', academicYear: '2026', status: 'active', combinationId: 'comb-pcm', parentName: 'Mrs. Doreen Atuhaire', parentContact: '+256 752 330 412' },
  { id: 'stu-s5-05', admissionNo: 'KHHS/26/505', fullName: 'Onyango Victor', gender: 'M', dateOfBirth: '2007-11-19', classId: 'cls-s5-sci', academicYear: '2026', status: 'active', combinationId: 'comb-pcm', parentName: 'Mr. Stephen Onyango', parentContact: '+256 774 510 923' },
  { id: 'stu-s5-06', admissionNo: 'KHHS/26/506', fullName: 'Mbabazi Lydia', gender: 'F', dateOfBirth: '2008-04-28', classId: 'cls-s5-sci', academicYear: '2026', status: 'active', combinationId: 'comb-pcm', parentName: 'Mr. Kenneth Mbabazi', parentContact: '+256 703 771 208' },
  { id: 'stu-s5-07', admissionNo: 'KHHS/26/507', fullName: 'Ssekandi Arnold', gender: 'M', dateOfBirth: '2008-08-12', classId: 'cls-s5-sci', academicYear: '2026', status: 'active', combinationId: 'comb-pcm', parentName: 'Mrs. Betty Ssekandi', parentContact: '+256 779 220 441' },
  { id: 'stu-s5-08', admissionNo: 'KHHS/26/508', fullName: 'Kyomuhendo Ruth', gender: 'F', dateOfBirth: '2008-02-05', classId: 'cls-s5-sci', academicYear: '2026', status: 'active', combinationId: 'comb-pcm', parentName: 'Dr. Grace Kyomuhendo', parentContact: '+256 772 511 089' },

  // S.6 Arts (5 students)
  { id: 'stu-s6-01', admissionNo: 'KHHS/25/601', fullName: 'Nanyonjo Claire', gender: 'F', dateOfBirth: '2007-05-16', classId: 'cls-s6-arts', academicYear: '2026', status: 'active', combinationId: 'comb-heg', parentName: 'Mrs. Margaret Nanyonjo', parentContact: '+256 772 190 442' },
  { id: 'stu-s6-02', admissionNo: 'KHHS/25/602', fullName: 'Bukenya Isaac', gender: 'M', dateOfBirth: '2007-03-21', classId: 'cls-s6-arts', academicYear: '2026', status: 'active', combinationId: 'comb-heg', parentName: 'Mr. Joseph Bukenya', parentContact: '+256 701 667 891' },
  { id: 'stu-s6-03', admissionNo: 'KHHS/25/603', fullName: 'Asiimwe Sharon', gender: 'F', dateOfBirth: '2007-09-10', classId: 'cls-s6-arts', academicYear: '2026', status: 'active', combinationId: 'comb-heg', parentName: 'Mrs. Olivia Asiimwe', parentContact: '+256 782 401 229' },
  { id: 'stu-s6-04', admissionNo: 'KHHS/25/604', fullName: 'Lubega Derrick', gender: 'M', dateOfBirth: '2007-01-30', classId: 'cls-s6-arts', academicYear: '2026', status: 'active', combinationId: 'comb-heg', parentName: 'Mr. Samuel Lubega', parentContact: '+256 752 741 330' },
  { id: 'stu-s6-05', admissionNo: 'KHHS/25/605', fullName: 'Namono Pauline', gender: 'F', dateOfBirth: '2007-07-07', classId: 'cls-s6-arts', academicYear: '2026', status: 'active', combinationId: 'comb-heg', parentName: 'Mr. David Namono', parentContact: '+256 774 908 114' },
];

const SEED_EXAMS: ExaminationPeriod[] = [
  {
    id: 'exam-2026-t1',
    name: 'Term I End of Term',
    examType: 'End of Term',
    term: 'Term I',
    academicYear: '2026',
    levelScope: 'all',
    classIds: ['cls-s2-east', 'cls-s3-west', 'cls-s5-sci', 'cls-s6-arts'],
    examDate: '2026-04-24',
    submissionDeadline: '2026-05-01',
    locked: true,
    published: true,
    createdAt: '2026-04-01T08:00:00Z',
  },
  {
    id: 'exam-2026-t2',
    name: 'Term II End of Term',
    examType: 'End of Term',
    term: 'Term II',
    academicYear: '2026',
    levelScope: 'all',
    classIds: ['cls-s2-east', 'cls-s3-west', 'cls-s5-sci', 'cls-s6-arts'],
    examDate: '2026-08-14',
    submissionDeadline: '2026-08-21',
    locked: true,
    published: true,
    createdAt: '2026-08-01T08:00:00Z',
  },
  {
    id: 'exam-2026-t3',
    name: 'Term III End of Term',
    examType: 'End of Term',
    term: 'Term III',
    academicYear: '2026',
    levelScope: 'all',
    classIds: ['cls-s2-east', 'cls-s3-west', 'cls-s5-sci', 'cls-s6-arts'],
    examDate: '2026-11-10',
    submissionDeadline: '2026-11-20',
    locked: false,
    published: false,
    createdAt: '2026-11-01T08:00:00Z',
  },
];

function makeOlevelEntries(
  studentIds: string[],
  baseScores: Array<[number, number, number, number]>,
  leaveLastMissing = false
): Record<string, MarkEntryItem> {
  const entries: Record<string, MarkEntryItem> = {};
  studentIds.forEach((sid, idx) => {
    if (leaveLastMissing && idx === studentIds.length - 1) {
      entries[sid] = { u1: '2.1', u2: '2.0', u3: '', eot: '' };
      return;
    }
    const [u1, u2, u3, eot] = baseScores[idx % baseScores.length];
    entries[sid] = {
      u1: String(u1),
      u2: String(u2),
      u3: String(u3),
      eot: String(eot),
      competencyObservation:
        eot >= 80
          ? 'Consistently demonstrates strong mastery and practical application.'
          : eot >= 65
            ? 'Shows solid understanding across core unit tasks.'
            : 'Making steady progress; guided revision recommended.',
    };
  });
  return entries;
}

function makeAlevelEntries(
  studentIds: string[],
  scores: number[],
  leaveLastMissing = false
): Record<string, MarkEntryItem> {
  const entries: Record<string, MarkEntryItem> = {};
  studentIds.forEach((sid, idx) => {
    if (leaveLastMissing && idx === studentIds.length - 1) {
      entries[sid] = { mark: '' };
      return;
    }
    entries[sid] = { mark: String(scores[idx % scores.length]) };
  });
  return entries;
}

const s2Ids = SEED_STUDENTS.filter((s) => s.classId === 'cls-s2-east').map((s) => s.id);
const s3Ids = SEED_STUDENTS.filter((s) => s.classId === 'cls-s3-west').map((s) => s.id);
const s5Ids = SEED_STUDENTS.filter((s) => s.classId === 'cls-s5-sci').map((s) => s.id);
const s6Ids = SEED_STUDENTS.filter((s) => s.classId === 'cls-s6-arts').map((s) => s.id);

const S2_MATH_SCORES: Array<[number, number, number, number]> = [
  [2.8, 2.9, 2.7, 91],
  [2.5, 2.6, 2.4, 81],
  [2.9, 3.0, 2.8, 94],
  [2.0, 2.1, 1.9, 64],
  [2.6, 2.5, 2.7, 83],
  [1.4, 1.5, 1.3, 42],
  [2.3, 2.4, 2.5, 76],
  [2.1, 2.2, 2.0, 68],
  [2.5, 2.4, 2.6, 79],
  [1.6, 1.5, 1.7, 48],
];

const S2_ALT_SCORES: Array<[number, number, number, number]> = [
  [2.6, 2.8, 2.7, 86],
  [2.3, 2.4, 2.5, 76],
  [2.8, 2.9, 2.7, 89],
  [2.2, 2.0, 2.3, 69],
  [2.7, 2.6, 2.8, 85],
  [1.8, 1.7, 1.9, 56],
  [2.6, 2.5, 2.7, 82],
  [2.0, 2.1, 2.2, 65],
  [2.7, 2.8, 2.6, 86],
  [1.7, 1.8, 1.6, 53],
];

const S2_SCI_SCORES: Array<[number, number, number, number]> = [
  [2.9, 2.8, 3.0, 92],
  [2.4, 2.5, 2.3, 78],
  [2.7, 2.8, 2.9, 87],
  [1.8, 2.0, 1.9, 59],
  [2.4, 2.6, 2.5, 79],
  [1.5, 1.4, 1.6, 45],
  [2.4, 2.3, 2.5, 77],
  [2.3, 2.4, 2.2, 74],
  [2.5, 2.6, 2.4, 80],
  [1.5, 1.4, 1.6, 46],
];

function shiftOlevel(
  base: Array<[number, number, number, number]>,
  deltaAoI: number,
  deltaEot: number
): Array<[number, number, number, number]> {
  return base.map(([u1, u2, u3, eot]) => [
    Number(Math.min(3, Math.max(0.5, u1 + deltaAoI)).toFixed(1)),
    Number(Math.min(3, Math.max(0.5, u2 + deltaAoI)).toFixed(1)),
    Number(Math.min(3, Math.max(0.5, u3 + deltaAoI)).toFixed(1)),
    Math.min(100, Math.max(25, eot + deltaEot)),
  ]);
}

function buildSeedMarksheets(): MarksheetRecord[] {
  const sheets: MarksheetRecord[] = [];
  const addSheet = (
    examId: string,
    classId: string,
    subjectId: string,
    teacherId: string,
    status: MarksheetRecord['status'],
    entries: Record<string, MarkEntryItem>,
    dosComment?: string
  ) => {
    sheets.push({
      id: `ms-${examId}-${classId}-${subjectId}`,
      examId,
      classId,
      subjectId,
      teacherId,
      status,
      entries,
      submittedAt: status !== 'draft' ? '2026-11-12T11:30:00Z' : undefined,
      submittedBy: status !== 'draft' ? teacherId : undefined,
      approvedAt:
        status === 'approved' || status === 'published' ? '2026-11-13T14:20:00Z' : undefined,
      approvedBy: status === 'approved' || status === 'published' ? 'usr-dos' : undefined,
      dosComment,
      lastModified: '2026-11-14T10:15:00Z',
      auditHistory: [
        {
          id: `aud-1-${examId}-${classId}-${subjectId}`,
          timestamp: '2026-11-11T09:00:00Z',
          actorId: teacherId,
          actorName: SEED_USERS.find((u) => u.id === teacherId)?.name ?? 'Subject Teacher',
          actorRole: 'teacher',
          action: 'Marks Entered',
          details: 'Initial assessment scores recorded',
        },
        ...(status !== 'draft'
          ? [
              {
                id: `aud-2-${examId}-${classId}-${subjectId}`,
                timestamp: '2026-11-12T11:30:00Z',
                actorId: teacherId,
                actorName: SEED_USERS.find((u) => u.id === teacherId)?.name ?? 'Subject Teacher',
                actorRole: 'teacher' as const,
                action: 'Submitted to DOS',
                details: 'Marksheet submitted for verification',
              },
            ]
          : []),
        ...(status === 'approved' || status === 'published'
          ? [
              {
                id: `aud-3-${examId}-${classId}-${subjectId}`,
                timestamp: '2026-11-13T14:20:00Z',
                actorId: 'usr-dos',
                actorName: 'Mrs. Grace Nakimuli',
                actorRole: 'dos' as const,
                action: status === 'published' ? 'Published Results' : 'Approved by DOS',
                details: 'Verified completeness and grading calculations',
              },
            ]
          : []),
        ...(status === 'returned'
          ? [
              {
                id: `aud-4-${examId}-${classId}-${subjectId}`,
                timestamp: '2026-11-13T15:10:00Z',
                actorId: 'usr-dos',
                actorName: 'Mrs. Grace Nakimuli',
                actorRole: 'dos' as const,
                action: 'Returned for Revision',
                details: dosComment ?? 'Please verify missing or borderline marks.',
              },
            ]
          : []),
      ],
    });
  };

  // Historical Term I & Term II Published Marksheets (for Academic History tracking)
  for (const [examId, dAoI, dEot, aDelta] of [
    ['exam-2026-t1', -0.2, -7, -6] as const,
    ['exam-2026-t2', -0.1, -3, -3] as const,
  ]) {
    const s2 = SEED_CLASSES[0];
    s2.subjectIds.forEach((subId, idx) => {
      const base = idx % 3 === 0 ? S2_MATH_SCORES : idx % 3 === 1 ? S2_ALT_SCORES : S2_SCI_SCORES;
      addSheet(
        examId,
        s2.id,
        subId,
        s2.subjectTeacherMap[subId],
        'published',
        makeOlevelEntries(s2Ids, shiftOlevel(base, dAoI, dEot))
      );
    });
    const s3 = SEED_CLASSES[1];
    s3.subjectIds.forEach((subId, idx) => {
      const base = idx % 2 === 0 ? S2_MATH_SCORES : S2_ALT_SCORES;
      addSheet(
        examId,
        s3.id,
        subId,
        s3.subjectTeacherMap[subId],
        'published',
        makeOlevelEntries(s3Ids, shiftOlevel(base, dAoI, dEot))
      );
    });
    const s5 = SEED_CLASSES[2];
    const aBase = [91, 76, 88, 62, 95, 71, 42, 82];
    s5.subjectIds.forEach((subId, idx) => {
      addSheet(
        examId,
        s5.id,
        subId,
        s5.subjectTeacherMap[subId],
        'published',
        makeAlevelEntries(s5Ids, aBase.map((v) => Math.max(30, Math.min(98, v + aDelta - idx))))
      );
    });
    const s6 = SEED_CLASSES[3];
    const a6Base = [84, 72, 79, 58, 88];
    s6.subjectIds.forEach((subId, idx) => {
      addSheet(
        examId,
        s6.id,
        subId,
        s6.subjectTeacherMap[subId],
        'published',
        makeAlevelEntries(s6Ids, a6Base.map((v) => Math.max(35, Math.min(96, v + aDelta + (idx % 2 === 0 ? 1 : -2)))))
      );
    });
  }

  // Active Term III End of Term Marksheets (Realistic mix of Approved, Submitted, Returned, Draft)
  // S.2 East
  addSheet('exam-2026-t3', 'cls-s2-east', 'sub-o-math', 'usr-teacher-math', 'approved', makeOlevelEntries(s2Ids, S2_MATH_SCORES));
  addSheet('exam-2026-t3', 'cls-s2-east', 'sub-o-engl', 'usr-teacher-hum', 'submitted', makeOlevelEntries(s2Ids, S2_ALT_SCORES));
  addSheet('exam-2026-t3', 'cls-s2-east', 'sub-o-biol', 'usr-teacher-sci', 'approved', makeOlevelEntries(s2Ids, S2_SCI_SCORES));
  addSheet('exam-2026-t3', 'cls-s2-east', 'sub-o-chem', 'usr-teacher-sci', 'submitted', makeOlevelEntries(s2Ids, shiftOlevel(S2_SCI_SCORES, -0.1, -4)));
  addSheet(
    'exam-2026-t3',
    'cls-s2-east',
    'sub-o-geog',
    'usr-teacher-hum',
    'returned',
    makeOlevelEntries(s2Ids, shiftOlevel(S2_ALT_SCORES, 0, -2), true),
    'Missing U3 & EoT marks for Okot Emmanuel (KHHS/26/210). Please verify attendance register and update.'
  );
  addSheet('exam-2026-t3', 'cls-s2-east', 'sub-o-ict', 'usr-teacher-sci', 'approved', makeOlevelEntries(s2Ids, shiftOlevel(S2_MATH_SCORES, 0.1, 3)));

  // S.3 West
  addSheet('exam-2026-t3', 'cls-s3-west', 'sub-o-math', 'usr-teacher-math', 'submitted', makeOlevelEntries(s3Ids, S2_MATH_SCORES));
  addSheet('exam-2026-t3', 'cls-s3-west', 'sub-o-engl', 'usr-teacher-hum', 'approved', makeOlevelEntries(s3Ids, S2_ALT_SCORES));
  addSheet('exam-2026-t3', 'cls-s3-west', 'sub-o-phys', 'usr-teacher-math', 'draft', makeOlevelEntries(s3Ids, shiftOlevel(S2_SCI_SCORES, 0, -1), true));
  addSheet('exam-2026-t3', 'cls-s3-west', 'sub-o-hist', 'usr-teacher-hum', 'approved', makeOlevelEntries(s3Ids, shiftOlevel(S2_ALT_SCORES, -0.1, -3)));
  addSheet('exam-2026-t3', 'cls-s3-west', 'sub-o-entr', 'usr-dos', 'approved', makeOlevelEntries(s3Ids, shiftOlevel(S2_MATH_SCORES, 0.1, 2)));

  // S.5 Science (A'Level)
  addSheet('exam-2026-t3', 'cls-s5-sci', 'sub-a-math', 'usr-teacher-math', 'approved', makeAlevelEntries(s5Ids, [91, 76, 88, 62, 95, 71, 42, 82]));
  addSheet('exam-2026-t3', 'cls-s5-sci', 'sub-a-phys', 'usr-teacher-math', 'submitted', makeAlevelEntries(s5Ids, [89, 74, 85, 58, 93, 66, 46, 79]));
  addSheet('exam-2026-t3', 'cls-s5-sci', 'sub-a-chem', 'usr-teacher-sci', 'approved', makeAlevelEntries(s5Ids, [86, 71, 90, 54, 91, 68, 51, 84]));
  addSheet('exam-2026-t3', 'cls-s5-sci', 'sub-a-gp', 'usr-teacher-hum', 'approved', makeAlevelEntries(s5Ids, [84, 79, 87, 69, 81, 85, 62, 88]));
  addSheet('exam-2026-t3', 'cls-s5-sci', 'sub-a-sict', 'usr-teacher-sci', 'submitted', makeAlevelEntries(s5Ids, [88, 82, 83, 72, 79, 86, 59, 85]));

  // S.6 Arts (A'Level)
  addSheet('exam-2026-t3', 'cls-s6-arts', 'sub-a-hist', 'usr-teacher-hum', 'approved', makeAlevelEntries(s6Ids, [85, 73, 81, 60, 89]));
  addSheet('exam-2026-t3', 'cls-s6-arts', 'sub-a-econ', 'usr-dos', 'approved', makeAlevelEntries(s6Ids, [82, 69, 77, 56, 86]));
  addSheet('exam-2026-t3', 'cls-s6-arts', 'sub-a-geog', 'usr-teacher-hum', 'submitted', makeAlevelEntries(s6Ids, [80, 74, 79, 63, 84]));
  addSheet('exam-2026-t3', 'cls-s6-arts', 'sub-a-gp', 'usr-teacher-hum', 'approved', makeAlevelEntries(s6Ids, [84, 76, 82, 68, 87]));
  addSheet('exam-2026-t3', 'cls-s6-arts', 'sub-a-smath', 'usr-teacher-math', 'draft', makeAlevelEntries(s6Ids, [74, 65, 71, 48, 79]));

  return sheets;
}

export const INITIAL_SCHOOL_DATABASE: SchoolDatabase = {
  users: SEED_USERS,
  loginActivity: [
    {
      id: 'log-1',
      userId: 'usr-dos',
      userName: 'Mrs. Grace Nakimuli',
      role: 'dos',
      timestamp: '2026-11-15T08:10:00Z',
      action: 'login',
    },
    {
      id: 'log-2',
      userId: 'usr-teacher-math',
      userName: 'Mr. Brian Ssebunya',
      role: 'teacher',
      timestamp: '2026-11-15T08:30:00Z',
      action: 'login',
    },
    {
      id: 'log-3',
      userId: 'usr-head',
      userName: 'Mr. Godfrey Ssemakula',
      role: 'headteacher',
      timestamp: '2026-11-15T07:55:00Z',
      action: 'login',
    },
  ],
  subjects: SEED_SUBJECTS,
  combinations: SEED_COMBINATIONS,
  classes: SEED_CLASSES,
  students: SEED_STUDENTS,
  exams: SEED_EXAMS,
  marksheets: buildSeedMarksheets(),
  studentRemarks: {},
  settings: DEFAULT_SCHOOL_SETTINGS,
  reportsGeneratedCount: 42,
};
