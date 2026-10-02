import nodemailer from 'nodemailer';
import { config } from '../config';
import { logger } from '../middleware/logger';
import { JournalEntry } from '../types';

function buildEmailHtml(entry: JournalEntry): string {
  const pnlColor = entry.daily_pnl >= 0 ? '#16a34a' : '#dc2626';
  const pnlSign = entry.daily_pnl >= 0 ? '+' : '';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb;">
  <div style="background: #1e293b; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
    <h1 style="margin: 0; font-size: 20px;">🤖 Trading Agent Report</h1>
    <p style="margin: 4px 0 0; opacity: 0.7;">${entry.date}</p>
  </div>

  <div style="background: white; padding: 20px; border: 1px solid #e2e8f0;">
    <h2 style="color: #374151; margin-top: 0;">Portfolio Summary</h2>
    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #f1f5f9; color: #6b7280;">Portfolio Value</td>
        <td style="padding: 8px; border-bottom: 1px solid #f1f5f9; font-weight: bold;">$${entry.portfolio_value.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
      </tr>
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #f1f5f9; color: #6b7280;">Cash</td>
        <td style="padding: 8px; border-bottom: 1px solid #f1f5f9;">$${entry.cash.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
      </tr>
      <tr>
        <td style="padding: 8px; color: #6b7280;">Daily P&L</td>
        <td style="padding: 8px; font-weight: bold; color: ${pnlColor};">
          ${pnlSign}$${Math.abs(entry.daily_pnl).toFixed(2)} (${pnlSign}${entry.daily_pnl_pct.toFixed(2)}%)
        </td>
      </tr>
    </table>
  </div>

  <div style="background: white; padding: 20px; border: 1px solid #e2e8f0; border-top: none;">
    <h2 style="color: #374151;">Market Research</h2>
    <pre style="background: #f8fafc; padding: 12px; border-radius: 4px; font-size: 12px; white-space: pre-wrap;">${entry.research_summary}</pre>
  </div>

  <div style="background: white; padding: 20px; border: 1px solid #e2e8f0; border-top: none;">
    <h2 style="color: #374151;">Trades Executed</h2>
    <pre style="background: #f8fafc; padding: 12px; border-radius: 4px; font-size: 12px; white-space: pre-wrap;">${entry.trades_summary}</pre>
  </div>

  <div style="background: white; padding: 20px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
    <h2 style="color: #374151;">Reflection</h2>
    <p style="color: #374151; line-height: 1.6;">${entry.reflection}</p>
  </div>

  <p style="text-align: center; color: #9ca3af; font-size: 12px; margin-top: 16px;">
    Trading Agent — Paper Mode | ${new Date().toLocaleString()}
  </p>
</body>
</html>`;
}

export async function sendDailyReport(entry: JournalEntry): Promise<void> {
  if (!config.email.appPassword) {
    logger.warn('Gmail App Password not configured — skipping email');
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: config.email.user,
      pass: config.email.appPassword,
    },
  });

  const pnlSign = entry.daily_pnl >= 0 ? '+' : '';
  const subject = `Trading Agent Report ${entry.date} | ${pnlSign}$${entry.daily_pnl.toFixed(2)} (${pnlSign}${entry.daily_pnl_pct.toFixed(2)}%)`;

  await transporter.sendMail({
    from: `"Trading Agent" <${config.email.user}>`,
    to: config.email.notifyEmail,
    subject,
    html: buildEmailHtml(entry),
  });

  logger.info('Daily report email sent', { to: config.email.notifyEmail, date: entry.date });
}
