export function processStudentPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Invalid image result.'));
        return;
      }
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image format.'));
      img.onload = () => {
        const targetW = 240;
        const targetH = 280;
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(reader.result as string);
          return;
        }
        // Center-crop to portrait passport ratio (6:7)
        const srcRatio = img.width / img.height;
        const dstRatio = targetW / targetH;
        let sx = 0;
        let sy = 0;
        let sw = img.width;
        let sh = img.height;
        if (srcRatio > dstRatio) {
          sw = img.height * dstRatio;
          sx = (img.width - sw) / 2;
        } else {
          sh = img.width / dstRatio;
          sy = (img.height - sh) / 2;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
        resolve(canvas.toDataURL('image/jpeg', 0.84));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function processSchoolBadge(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > 4 * 1024 * 1024) {
      reject(new Error('School badge image must be under 4 MB.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read school badge file.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Invalid badge image result.'));
        return;
      }
      const img = new Image();
      img.onerror = () => reject(new Error('Unsupported badge image format.'));
      img.onload = () => {
        const maxSide = 256;
        const scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
        const targetW = Math.max(1, Math.round(img.width * scale));
        const targetH = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(reader.result as string);
          return;
        }
        ctx.clearRect(0, 0, targetW, targetH);
        ctx.drawImage(img, 0, 0, targetW, targetH);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
