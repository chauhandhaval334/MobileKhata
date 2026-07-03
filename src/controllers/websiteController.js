'use strict';

const { query } = require('../config/database');
const { success } = require('../utils/response');
const logger = require('../utils/logger');

exports.getWebsiteConfig = async (req, res) => {
  let config = {
    heroTitle: 'Manage Your Mobile Shop with Ease',
    heroSubtitle: 'MobileKhata is the ultimate ledger and inventory management app designed specifically for mobile shop owners. Keep track of sales, purchases, and repairs effortlessly.',
    aboutText: 'MobileKhata was built to solve the daily challenges of mobile shop owners. From tracking IMEI numbers to maintaining customer ledgers and generating professional PDF invoices, our app digitizes your entire business workflow.',
    appUpdateUrl: 'https://play.google.com/store/apps/details?id=com.mobilekhata',
    privacyPolicyUrl: '/privacy.html',
    termsOfServiceUrl: '/terms.html',
    supportWhatsapp: '+918160707979',
    supportEmail: 'support@mobilekhata.com'
  };

  try {
    const configRes = await query('SELECT key, value FROM app_config');
    const dbConfigs = {};
    configRes.rows.forEach(r => { dbConfigs[r.key] = r.value; });

    if (dbConfigs.website_hero_title) config.heroTitle = dbConfigs.website_hero_title;
    if (dbConfigs.website_hero_subtitle) config.heroSubtitle = dbConfigs.website_hero_subtitle;
    if (dbConfigs.website_about_text) config.aboutText = dbConfigs.website_about_text;
    if (dbConfigs.app_update_url) config.appUpdateUrl = dbConfigs.app_update_url;
    if (dbConfigs.privacy_policy_url) config.privacyPolicyUrl = dbConfigs.privacy_policy_url;
    if (dbConfigs.terms_of_service_url) config.termsOfServiceUrl = dbConfigs.terms_of_service_url;
    if (dbConfigs.support_whatsapp) config.supportWhatsapp = dbConfigs.support_whatsapp;
    if (dbConfigs.support_email) config.supportEmail = dbConfigs.support_email;

  } catch (err) {
    logger.error('Failed to load website config', { error: err.message });
  }

  return success(res, config);
};
