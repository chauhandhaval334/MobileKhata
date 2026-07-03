document.getElementById('web-contact-form')?.addEventListener('submit', function(e) {
  e.preventDefault();
  const name = document.getElementById('form-name').value;
  const phone = document.getElementById('form-phone').value;
  const message = document.getElementById('form-message').value;
  const feedback = document.getElementById('form-feedback');

  if (feedback) {
    feedback.className = 'form-feedback success';
    feedback.textContent = 'Thank you, ' + name + '! Your message has been sent successfully. We will get back to you shortly.';
    this.reset();
  }
});

// Fetch dynamic configurations on load and update page links
fetch('/api/v2/website')
  .then(response => response.json())
  .then(res => {
    if (res.success && res.data) {
      const config = res.data;
      
      // Update Privacy Policy link
      const privacyLink = document.getElementById('privacy-link');
      if (privacyLink && config.privacyPolicyUrl) {
        privacyLink.href = config.privacyPolicyUrl;
      }
      
      // Update Terms of Service link
      const termsLink = document.getElementById('terms-link');
      if (termsLink && config.termsOfServiceUrl) {
        termsLink.href = config.termsOfServiceUrl;
      }
      
      // Update Support Email
      const emailText = document.getElementById('support-email-text');
      if (emailText && config.supportEmail) {
        emailText.innerHTML = `<a href="mailto:${config.supportEmail}">${config.supportEmail}</a>`;
      }
      
      // Update Support WhatsApp Link
      const whatsappText = document.getElementById('support-whatsapp-text');
      if (whatsappText && config.supportWhatsapp) {
        const cleanNo = config.supportWhatsapp.replace('+', '');
        whatsappText.innerHTML = `<a href="https://wa.me/${cleanNo}" target="_blank" rel="noopener">WhatsApp Chat: ${config.supportWhatsapp}</a>`;
      }
      
      // Update Play Store Download link
      const downloadBtn = document.getElementById('download-btn');
      if (downloadBtn && config.appUpdateUrl) {
        downloadBtn.href = config.appUpdateUrl;
      }
    }
  })
  .catch(err => console.error('Failed to load dynamic website configurations:', err));
