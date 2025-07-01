import 'dotenv/config';
// import sgMail from '@sendgrid/mail';
import nodemailer from 'nodemailer'

export async function sendGoogleSheetLinkByEmail(to: string, sheetUrl: string) {
  // sgMail.setApiKey(process.env.API_KEY_MAIL || '');

  // await sgMail.send({
  //   to,
  //   from: process.env.SMTP_USER || '',
  //   subject: 'Отчет по работе с лидами',
  //   html: `<p>Здравствуйте. Отчет о работе с лидами по ссылке: <a href="${sheetUrl}">${sheetUrl}</a></p>`,
  // });
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
    subject: 'Отчет по работе с лидами',
    html: `<p>Здравствуйте. Отчет о работе с лидами по ссылке: <a href="${sheetUrl}">${sheetUrl}</a></p>`,
  });
}
