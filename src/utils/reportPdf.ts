import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DEFAULT_REPORT_CARD_LAYOUT } from '../data/sampleData';
import type {
  ClassPerformanceSummary,
  ExamClass,
  ReportCardAccent,
  ReportCardLayoutConfig,
  SchoolSettings,
  StudentCalculatedResult,
} from '../types';
import { getGradingScaleForLevel } from './calculations';

const ACCENT_RGB: Record<ReportCardAccent, [number, number, number]> = {
  navy: [30, 58, 138],
  emerald: [6, 95, 70],
  burgundy: [136, 19, 55],
  indigo: [55, 48, 163],
  slate: [15, 23, 42],
};

function sanitizePdfText(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/\s+/g, ' ').trim();
}

async function loadImageAsDataUrl(src: string | undefined): Promise<string | null> {
  const clean = (src ?? '').trim();
  if (!clean) return null;
  if (clean.startsWith('data:image/')) {
    return clean;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = window.setTimeout(() => resolve(null), 5000);

    img.onload = () => {
      window.clearTimeout(timer);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 200;
        canvas.height = img.naturalHeight || 200;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    };

    img.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };

    img.src = clean;
  });
}

function getImageFormat(dataUrl: string): 'PNG' | 'JPEG' | 'WEBP' {
  if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) {
    return 'JPEG';
  }
  if (dataUrl.startsWith('data:image/webp')) {
    return 'WEBP';
  }
  return 'PNG';
}

export async function downloadReportCardsPdf(params: {
  students: StudentCalculatedResult[];
  examClass: ExamClass;
  summary: ClassPerformanceSummary;
  settings: SchoolSettings;
  fileName: string;
}): Promise<void> {
  const { students, examClass, summary, settings, fileName } = params;
  if (students.length === 0) return;

  const layout: ReportCardLayoutConfig = {
    ...DEFAULT_REPORT_CARD_LAYOUT,
    ...(settings.reportLayout ?? {}),
  };
  const accentRgb = ACCENT_RGB[layout.accentColor] ?? ACCENT_RGB.navy;
  const isOlevel = examClass.level === 'olevel';
  const cbc = settings.cbcConfig;
  const aPolicy = settings.alevelPolicy;
  const scale = getGradingScaleForLevel(examClass.level, settings);

  const subjectMeanPctMap = new Map(
    summary.subjectSummaries.map((s) => [s.subjectId, s.meanPercent])
  );
  const subjectMeanMap = new Map(summary.subjectSummaries.map((s) => [s.subjectId, s.mean]));

  const logoSrc =
    layout.crestType === 'custom'
      ? layout.customLogoDataUrl ?? settings.badgeDataUrl
      : settings.badgeDataUrl;
  const resolvedLogo = layout.crestType === 'none' ? null : await loadImageAsDataUrl(logoSrc);

  // Preload student passport photos concurrently in small chunks
  const studentPhotoMap = new Map<string, string | null>();
  if (layout.showStudentPhoto) {
    await Promise.all(
      students.map(async (stu) => {
        if (!stu.photoDataUrl) {
          studentPhotoMap.set(stu.studentId, null);
          return;
        }
        const resolved = await loadImageAsDataUrl(stu.photoDataUrl);
        studentPhotoMap.set(stu.studentId, resolved);
      })
    );
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = 210;
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;

  for (let idx = 0; idx < students.length; idx++) {
    const stu = students[idx];
    if (idx > 0) doc.addPage('a4', 'portrait');

    let y = 12;
    const isModern = layout.style === 'modern';

    // 1. Header Banner / Letterhead
    if (isModern) {
      doc.setFillColor(...accentRgb);
      doc.roundedRect(margin, y, contentWidth, 24, 1.5, 1.5, 'F');

      if (resolvedLogo) {
        try {
          doc.setFillColor(255, 255, 255);
          doc.roundedRect(margin + 3, y + 3, 18, 18, 1, 1, 'F');
          doc.addImage(resolvedLogo, getImageFormat(resolvedLogo), margin + 4, y + 4, 16, 16);
        } catch {
          // Ignore malformed logo image
        }
      }

      const textStartX = resolvedLogo ? margin + 24 : margin + 4;
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text(sanitizePdfText(settings.schoolName), textStartX, y + 8);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      if (layout.schoolMotto) {
        doc.text(sanitizePdfText(layout.schoolMotto), textStartX, y + 13.5);
      }
      if (layout.schoolContact) {
        doc.text(sanitizePdfText(layout.schoolContact), textStartX, y + 18.5);
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.text(
        sanitizePdfText(layout.reportTitle || 'Official Terminal Academic Report'),
        pageWidth - margin - 4,
        y + 8,
        { align: 'right' }
      );
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(
        `${isOlevel ? "O'Level CBC Report" : "A'Level UACE Report"} · ${settings.academicYear}`,
        pageWidth - margin - 4,
        y + 13.5,
        { align: 'right' }
      );
      doc.text(sanitizePdfText(examClass.examTitle), pageWidth - margin - 4, y + 18.5, {
        align: 'right',
      });

      y += 28;
    } else {
      if (resolvedLogo) {
        try {
          doc.addImage(resolvedLogo, getImageFormat(resolvedLogo), margin, y, 16, 16);
        } catch {
          // Ignore malformed logo
        }
      }

      const textStartX = resolvedLogo ? margin + 19 : margin;
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text(sanitizePdfText(settings.schoolName), textStartX, y + 5.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(71, 85, 105);
      if (layout.schoolMotto) {
        doc.text(sanitizePdfText(layout.schoolMotto), textStartX, y + 10.5);
      }
      doc.text(
        sanitizePdfText(`${examClass.examTitle}${layout.schoolContact ? ` · ${layout.schoolContact}` : ''}`),
        textStartX,
        y + 15
      );

      doc.setTextColor(...accentRgb);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.text(
        sanitizePdfText(layout.reportTitle || 'Official Terminal Academic Report'),
        pageWidth - margin,
        y + 5.5,
        { align: 'right' }
      );
      doc.setTextColor(71, 85, 105);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(
        isOlevel ? "Lower Secondary · O'Level CBC" : "Upper Secondary · A'Level UACE",
        pageWidth - margin,
        y + 10.5,
        { align: 'right' }
      );
      doc.text(`Exam Date: ${examClass.examDate}`, pageWidth - margin, y + 15, {
        align: 'right',
      });

      y += 18.5;
      doc.setDrawColor(...accentRgb);
      doc.setLineWidth(0.7);
      doc.line(margin, y, pageWidth - margin, y);
      y += 4;
    }

    // 2. Student Metadata Row + Optional Passport Photo
    const photoData = studentPhotoMap.get(stu.studentId) ?? null;
    const hasPhotoSlot = layout.showStudentPhoto;
    const metaWidth = hasPhotoSlot ? contentWidth - 25 : contentWidth;
    const colW = metaWidth / 4;

    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.setFont('helvetica', 'normal');
    doc.text('Student Name', margin, y + 3);
    doc.text('Admission No.', margin + colW, y + 3);
    doc.text('Class & Teacher', margin + colW * 2, y + 3);
    doc.text(layout.showClassPosition ? 'Class Position' : 'Standing', margin + colW * 3, y + 3);

    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.text(sanitizePdfText(stu.name).slice(0, 26), margin, y + 8);
    doc.text(sanitizePdfText(stu.admissionNo), margin + colW, y + 8);
    doc.setFont('helvetica', 'normal');
    doc.text(sanitizePdfText(examClass.className), margin + colW * 2, y + 8);
    doc.setFont('helvetica', 'bold');
    doc.text(
      layout.showClassPosition ? `#${stu.rank} of ${summary.studentResults.length}` : stu.status,
      margin + colW * 3,
      y + 8
    );

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Gender: ${stu.gender}`, margin, y + 12.5);
    if (!isOlevel && stu.combinationCode) {
      doc.text(`Comb: ${stu.combinationCode}`, margin + colW, y + 12.5);
    }
    doc.text(sanitizePdfText(examClass.classTeacher).slice(0, 26), margin + colW * 2, y + 12.5);

    if (hasPhotoSlot) {
      const px = pageWidth - margin - 20;
      const py = y - 1;
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.3);
      doc.rect(px, py, 20, 22);
      if (photoData) {
        try {
          doc.addImage(photoData, getImageFormat(photoData), px + 0.5, py + 0.5, 19, 21);
        } catch {
          doc.setFontSize(6.5);
          doc.text('Photo', px + 10, py + 11.5, { align: 'center' });
        }
      } else {
        doc.setFontSize(6.5);
        doc.setTextColor(148, 163, 184);
        doc.text('Passport', px + 10, py + 10, { align: 'center' });
        doc.text('Photo', px + 10, py + 13.5, { align: 'center' });
      }
      y += 23;
    } else {
      y += 15;
    }

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.25);
    doc.line(margin, y, pageWidth - margin, y);
    y += 3;

    // 3. Subject Results Table
    if (isOlevel) {
      const headCols = [
        'Subject',
        ...(layout.showSubjectTeacher ? ['Teacher'] : []),
        ...(cbc.aoiInputMode === 'single_aoi' ? ['Classwork'] : ['U1', 'U2', 'U3']),
        `AoI (${cbc.formativeWeight}%)`,
        `EoT (${cbc.summativeWeight}%)`,
        'Total',
        'ID',
        ...(layout.showClassAverage ? ['Avg'] : []),
        ...(layout.showSubjectRank ? ['Pos'] : []),
        'Grade',
        'Descriptor',
      ];

      const bodyRows = examClass.subjects.map((sub) => {
        const cell = stu.subjectResults[sub.id];
        const avgPct = subjectMeanPctMap.get(sub.id) ?? 0;
        const subTitle = layout.showSubjectCode ? `${sub.name} (${sub.code})` : sub.name;
        const aoiCells =
          cbc.aoiInputMode === 'single_aoi'
            ? [cell?.u1 !== null && cell?.u1 !== undefined ? cell.u1.toFixed(1) : '—']
            : [
                cell?.u1 !== null && cell?.u1 !== undefined ? cell.u1.toFixed(1) : '—',
                cell?.u2 !== null && cell?.u2 !== undefined ? cell.u2.toFixed(1) : '—',
                cell?.u3 !== null && cell?.u3 !== undefined ? cell.u3.toFixed(1) : '—',
              ];

        const totalDisplay = cell?.exempted
          ? 'EX'
          : cell?.missed
            ? 'ABS'
            : cell?.percentage !== null && cell?.percentage !== undefined
              ? `${cell.percentage.toFixed(1)}%`
              : '—';

        return [
          subTitle,
          ...(layout.showSubjectTeacher ? [sub.teacher || '—'] : []),
          ...aoiCells,
          cell?.aoiScore20 !== null && cell?.aoiScore20 !== undefined
            ? cell.aoiScore20.toFixed(1)
            : '—',
          cell?.eotScore80 !== null && cell?.eotScore80 !== undefined
            ? cell.eotScore80.toFixed(1)
            : '—',
          totalDisplay,
          cell?.identifier ?? '—',
          ...(layout.showClassAverage ? [`${avgPct.toFixed(1)}%`] : []),
          ...(layout.showSubjectRank ? [cell?.subjectRank ? `#${cell.subjectRank}` : '—'] : []),
          cell?.grade ?? '—',
          cell?.gradeLabel ?? '—',
        ];
      });

      const footRow = [
        'Overall CBC Standing',
        ...(layout.showSubjectTeacher ? [''] : []),
        ...(cbc.aoiInputMode === 'single_aoi' ? [''] : ['', '', '']),
        `Mean (${stu.assessedCount})`,
        '',
        `${stu.percentage.toFixed(1)}%`,
        '',
        ...(layout.showClassAverage ? [`${summary.classMeanPercent.toFixed(1)}%`] : []),
        ...(layout.showSubjectRank ? [layout.showClassPosition ? `#${stu.rank}` : '—'] : []),
        stu.grade,
        stu.gradeLabel,
      ];

      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        head: [headCols],
        body: bodyRows,
        foot: [footRow],
        theme: 'grid',
        styles: {
          fontSize: 7.2,
          cellPadding: 1.4,
          textColor: [30, 41, 59],
          lineColor: [203, 213, 225],
          lineWidth: 0.2,
        },
        headStyles: {
          fillColor: accentRgb,
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 7.2,
        },
        footStyles: {
          fillColor: [241, 245, 249],
          textColor: [15, 23, 42],
          fontStyle: 'bold',
        },
      });
      y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + 40) + 4;
    } else {
      const principalSubjects = examClass.subjects.filter((s) => s.category !== 'subsidiary');
      const subsidiarySubjects = examClass.subjects.filter((s) => s.category === 'subsidiary');

      const buildALevelRows = (list: typeof examClass.subjects) =>
        list.map((sub) => {
          const cell = stu.subjectResults[sub.id];
          const classMean = subjectMeanMap.get(sub.id) ?? 0;
          const subTitle = layout.showSubjectCode ? `${sub.name} (${sub.code})` : sub.name;
          const markVal = cell?.exempted
            ? 'EX'
            : cell?.missed
              ? 'ABS'
              : cell?.numericValue !== null && cell?.numericValue !== undefined
                ? String(cell.numericValue)
                : '—';

          return [
            subTitle,
            ...(layout.showSubjectTeacher ? [sub.teacher || '—'] : []),
            markVal,
            ...(layout.showClassAverage ? [classMean.toFixed(1)] : []),
            ...(layout.showSubjectRank ? [cell?.subjectRank ? `#${cell.subjectRank}` : '—'] : []),
            cell?.grade ?? '—',
            cell?.numericValue !== null && cell?.numericValue !== undefined ? String(cell.points) : '—',
            cell?.gradeLabel ?? '—',
          ];
        });

      const aHead = [
        'Principal Subject',
        ...(layout.showSubjectTeacher ? ['Teacher'] : []),
        'Mark (100)',
        ...(layout.showClassAverage ? ['Class Avg'] : []),
        ...(layout.showSubjectRank ? ['Pos'] : []),
        'Grade',
        'Points',
        'Descriptor',
      ];

      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        head: [aHead],
        body: buildALevelRows(principalSubjects),
        theme: 'grid',
        styles: {
          fontSize: 7.5,
          cellPadding: 1.6,
          textColor: [30, 41, 59],
          lineColor: [203, 213, 225],
          lineWidth: 0.2,
        },
        headStyles: {
          fillColor: accentRgb,
          textColor: [255, 255, 255],
          fontStyle: 'bold',
        },
      });
      y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + 35) + 3;

      if (subsidiarySubjects.length > 0) {
        const subHead = [
          'Subsidiary Paper',
          ...(layout.showSubjectTeacher ? ['Teacher'] : []),
          'Mark (100)',
          ...(layout.showClassAverage ? ['Class Avg'] : []),
          ...(layout.showSubjectRank ? ['Pos'] : []),
          'Grade',
          'Points',
          'Standing',
        ];
        autoTable(doc, {
          startY: y,
          margin: { left: margin, right: margin },
          head: [subHead],
          body: buildALevelRows(subsidiarySubjects),
          theme: 'grid',
          styles: {
            fontSize: 7.5,
            cellPadding: 1.5,
            textColor: [30, 41, 59],
            lineColor: [203, 213, 225],
            lineWidth: 0.2,
          },
          headStyles: {
            fillColor: [71, 85, 105],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
          },
        });
        y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + 20) + 4;
      }
    }

    // 4. Overall Result Summary Strip
    if (layout.showOverallSummaryStrip) {
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(203, 213, 225);
      doc.roundedRect(margin, y, contentWidth, 14, 1, 1, 'FD');

      const sCol = contentWidth / 4;
      const maxUacePts =
        aPolicy.maxPrincipalsCount * 6 +
        (aPolicy.includeSubsidiaryPoints ? aPolicy.maxSubsidiariesCount : 0);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(isOlevel ? 'Overall CBC Grade' : 'Total UACE Points', margin + 3, y + 4.5);
      doc.text(isOlevel ? 'Term Average (%)' : 'Principal Passes', margin + sCol + 3, y + 4.5);
      doc.text('Subjects Passed', margin + sCol * 2 + 3, y + 4.5);
      doc.text('Academic Standing', margin + sCol * 3 + 3, y + 4.5);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(15, 23, 42);
      doc.text(
        isOlevel ? `${stu.grade} · ${stu.gradeLabel}` : `${stu.totalPoints} / ${maxUacePts} pts`,
        margin + 3,
        y + 10.5
      );
      doc.text(
        isOlevel
          ? `${stu.percentage.toFixed(1)}%`
          : `${stu.principalPassesCount}P + ${stu.subsidiaryPassesCount}S`,
        margin + sCol + 3,
        y + 10.5
      );
      doc.text(
        `${Math.max(0, stu.assessedCount - stu.failedSubjects.length)} / ${stu.subjectCount}`,
        margin + sCol * 2 + 3,
        y + 10.5
      );
      doc.text(stu.status, margin + sCol * 3 + 3, y + 10.5);

      y += 18;
    }

    // 5. Optional CBC Competency Observations
    if (isOlevel && layout.showCompetenciesSection) {
      const obsList = examClass.subjects
        .map((s) => ({
          name: s.name,
          obs: stu.subjectResults[s.id]?.competencyObservation,
        }))
        .filter((o): o is { name: string; obs: string } => Boolean(o.obs));

      if (obsList.length > 0 && y < 225) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(51, 65, 85);
        doc.text('CBC Competency Observations:', margin, y);
        y += 3.5;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        for (const item of obsList.slice(0, 4)) {
          const line = `${item.name}: ${sanitizePdfText(item.obs)}`;
          const wrapped = doc.splitTextToSize(line, contentWidth);
          doc.text(wrapped[0] ?? line, margin, y);
          y += 3.4;
        }
        y += 2;
      }
    }

    // 6. Remarks Section
    const halfW = (contentWidth - 4) / 2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(51, 65, 85);
    doc.text("Class Teacher's Remark", margin, y);
    doc.text("Headteacher's Remark", margin + halfW + 4, y);
    y += 2;

    doc.setDrawColor(203, 213, 225);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin, y, halfW, 13, 1, 1, 'FD');
    doc.roundedRect(margin + halfW + 4, y, halfW, 13, 1, 1, 'FD');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(30, 41, 59);
    const teacherLines = doc.splitTextToSize(sanitizePdfText(stu.teacherRemark), halfW - 4);
    const headLines = doc.splitTextToSize(sanitizePdfText(stu.headTeacherRemark), halfW - 4);
    doc.text(teacherLines.slice(0, 3), margin + 2, y + 4);
    doc.text(headLines.slice(0, 3), margin + halfW + 6, y + 4);
    y += 16;

    if (layout.showDosComment) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(51, 65, 85);
      doc.text('Director of Studies (DOS) Comment', margin, y);
      y += 2;
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(margin, y, contentWidth, 8.5, 1, 1, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      doc.setTextColor(30, 41, 59);
      const dosLines = doc.splitTextToSize(sanitizePdfText(stu.dosRemark), contentWidth - 4);
      doc.text(dosLines.slice(0, 2), margin + 2, y + 4);
      y += 11.5;
    }

    // 7. Next Term Dates
    if (layout.showNextTermDate && (layout.nextTermDate || layout.nextTermClosingDate)) {
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(margin, y, contentWidth, 7, 1, 1, 'FD');
      doc.setFontSize(7.5);
      doc.setTextColor(51, 65, 85);
      if (layout.nextTermClosingDate) {
        doc.text(`Term Closed On: ${layout.nextTermClosingDate}`, margin + 3, y + 4.7);
      }
      if (layout.nextTermDate) {
        doc.text(`Next Term Begins On: ${layout.nextTermDate}`, pageWidth - margin - 3, y + 4.7, {
          align: 'right',
        });
      }
      y += 10;
    }

    // 8. Grading Scale Key
    if (layout.showGradingKey) {
      const sortedScale = [...scale]
        .sort((a, b) => b.minPercentage - a.minPercentage)
        .map((b) => `${b.grade} (${b.minPercentage}%+${!isOlevel ? ` · ${b.gpa}pt` : ''})`)
        .join('  |  ');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(100, 116, 139);
      const keyLines = doc.splitTextToSize(
        `${isOlevel ? "O'Level CBC Key:" : "A'Level Principal Key:"} ${sortedScale}`,
        contentWidth
      );
      doc.text(keyLines.slice(0, 2), margin, y + 2);
    }

    // 9. Signatures & Stamp Footer anchored safely near bottom of A4 page
    const sigY = 268;
    const sigCols = layout.showParentSignature ? 3 : 2;
    const sigW = (layout.showSchoolStampBox && !layout.showParentSignature ? contentWidth - 42 : contentWidth) / sigCols;

    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.3);

    // Left signature
    doc.line(margin, sigY, margin + sigW - 6, sigY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(30, 41, 59);
    doc.text(sanitizePdfText(examClass.classTeacher), margin, sigY + 4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(sanitizePdfText(layout.leftSignatureLabel), margin, sigY + 7.5);

    // Right signature
    const x2 = margin + sigW;
    doc.line(x2, sigY, x2 + sigW - 6, sigY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(30, 41, 59);
    doc.text(sanitizePdfText(settings.principalName), x2, sigY + 4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(sanitizePdfText(layout.rightSignatureLabel), x2, sigY + 7.5);

    if (layout.showParentSignature) {
      const x3 = margin + sigW * 2;
      doc.line(x3, sigY, x3 + sigW - 4, sigY);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(30, 41, 59);
      doc.text('Parent / Guardian', x3, sigY + 4);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(sanitizePdfText(layout.parentSignatureLabel), x3, sigY + 7.5);
    } else if (layout.showSchoolStampBox) {
      const sx = pageWidth - margin - 36;
      doc.setDrawColor(148, 163, 184);
      doc.rect(sx, sigY - 8, 36, 14);
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text('Official School Stamp', sx + 18, sigY - 0.5, { align: 'center' });
    }

    if (layout.footerNote) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(sanitizePdfText(layout.footerNote), pageWidth / 2, 285, { align: 'center' });
    }
  }

  doc.save(fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`);
}
