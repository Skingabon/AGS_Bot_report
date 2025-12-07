import { Context, InlineKeyboard } from 'grammy';
import { isHasAccess } from '../auth/auth';

export const getBaseMenu = (ctx: Context): InlineKeyboard => {
  const menuKeyboard = new InlineKeyboard();

  if (isHasAccess(ctx)) {
    menuKeyboard.text('Для руководства', 'access-create-report').row();
  }

  menuKeyboard
    .text('Отчет по сделкам за вчерашний день', 'report-lead-yesterday')
    .row()
    .text('Отчет по сделкам за сегодня', 'report-lead-today')
    .row()
    .text('Отчет по сделкам за период', 'report-lead-period')
    .row();

  return menuKeyboard;
};

export const getBossMenu = () => {
  const bossMenu = new InlineKeyboard()
    .text('Маркетинг', 'report-marketing-period')
    .row()
    .text(
      'Создать отчет за посл. день (+ все поля квартал)',
      'report-time-last-day',
    )
    .row()
    .text('Создать отчет за выбранный период', 'report-time-period')
    .row()
    .text('Исх. звонки и все поля за квартал', 'generate-for-quartet')
    .row()
    .text('Сортировка за квартал', 'sort-for-quartet')
    .row()
    .text('Отправить ссылку на Google Таблицу на почту', 'send-google-link')
    .row()
    .text('⚠️ Исх. звонки и все поля (all)', 'incoming-call')
    .row()
    .text('⚠️ Сортировка всей таблицы', 'sort-all')
    .row()
    .text('Создать отчет Control', 'create-report-control')
    .row()
    .text('Вернуться в меню', 'menu')
    .row();

  return bossMenu;
};
