import nodemailer from 'nodemailer';

export async function sendGoogleSheetLinkByEmail(to: string, sheetUrl: string) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to,
    subject: 'Ссылка на Google Таблицу',
    html: `<p>Вот ссылка на нужную таблицу: <a href="${sheetUrl}">${sheetUrl}</a></p>`,
  });
}
