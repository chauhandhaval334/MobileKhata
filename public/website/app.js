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
