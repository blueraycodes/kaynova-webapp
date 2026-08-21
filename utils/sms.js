/**
 * OTP SMS sender.
 *
 * By default this just logs the OTP to the server console, so you can test
 * the whole login flow locally with zero setup / zero cost.
 *
 * To send REAL SMS in production, sign up for an SMS gateway (popular choices
 * in India: MSG91, Twilio, Fast2SMS, TextLocal) and replace the body of
 * sendOtpSms() below with a call to their API. Keep the same function
 * signature so nothing else in the app needs to change.
 *
 * Example (MSG91) - uncomment and fill in your keys:
 *
 * const axios = require('axios');
 * async function sendOtpSms(phone, code) {
 *   await axios.post('https://control.msg91.com/api/v5/otp', {
 *     mobile: '91' + phone,
 *     otp: code,
 *     authkey: process.env.MSG91_AUTH_KEY,
 *     template_id: process.env.MSG91_TEMPLATE_ID,
 *   });
 *   return true;
 * }
 *
 * Example (Twilio) - uncomment and fill in your keys:
 *
 * const twilio = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
 * async function sendOtpSms(phone, code) {
 *   await twilio.messages.create({
 *     body: `Your Kaynova OTP is ${code}. It expires in 5 minutes.`,
 *     from: process.env.TWILIO_PHONE_NUMBER,
 *     to: '+91' + phone,
 *   });
 *   return true;
 * }
 */

async function sendOtpSms(phone, code) {
  console.log(`\n📱 [DEV MODE] OTP for ${phone}: ${code}  (valid 5 minutes)\n`);
  return true;
}

module.exports = { sendOtpSms };
