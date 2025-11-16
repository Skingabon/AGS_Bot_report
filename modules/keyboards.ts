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
    .text('Создать отчет за последний день', 'report-time-last-day')
    .row()
    .text('Создать отчет за выбранный период', 'report-time-period')
    .row()
    //TODO Изменить логику заполнения поля Первое качание - если дата/время первого касапния младше даты создания сделки....
    .text('Заполнить исходящие звонки', 'generate')
    .row()
    .text('Отправить ссылку на Google Таблицу на почту', 'send-google-link')
    .row()
    .text('Вернуться в меню', 'menu')
    .row();

  return bossMenu;
};

export const getCancelKeyboard = (): InlineKeyboard => {
  return new InlineKeyboard().text('⏹️ Отменить', 'cancel_command').row();
};
