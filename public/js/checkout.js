/*
 * Checkout flow (Razorpay Checkout popup).
 *
 * IMPORTANT: nothing here is trusted as proof of payment. This script only
 * opens the Razorpay popup and, on its success callback, forwards the
 * payment/order/signature it received to POST /payments/razorpay/verify,
 * which is the only place a payment is actually confirmed — by verifying
 * the HMAC signature server-side with the secret key. If verification
 * fails there, no enrollment is created no matter what this script does.
 */
(function () {
  const payButton = document.getElementById('pay-button');
  if (!payButton) return;

  const errorBox = document.getElementById('pay-error');

  function showError(message) {
    if (errorBox) {
      errorBox.textContent = message;
      errorBox.style.display = 'block';
    }
  }

  function setLoading(isLoading) {
    payButton.disabled = isLoading;
    payButton.textContent = isLoading ? 'Please wait…' : 'Pay Securely';
  }

  payButton.addEventListener('click', function () {
    setLoading(true);
    if (errorBox) errorBox.style.display = 'none';

    const courseSlug = payButton.getAttribute('data-course-slug');
    const csrfToken = payButton.getAttribute('data-csrf');

    fetch(`/checkout/${courseSlug}/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `_csrf=${encodeURIComponent(csrfToken)}`,
    })
      .then(function (response) {
        return response.json().then(function (data) {
          return { ok: response.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok || !result.data.success) {
          throw new Error((result.data && result.data.error) || 'Could not start payment.');
        }

        const order = result.data;

        const options = {
          key: order.keyId,
          amount: order.amount,
          currency: order.currency,
          name: 'Institute of Cosmetology & Dental Sciences',
          description: order.courseName,
          order_id: order.providerOrderId,
          prefill: {
            name: order.studentName,
            email: order.studentEmail,
          },
          theme: { color: '#565acf' },
          handler: function (response) {
            // Popup reported success — this is NOT trusted yet. Forward to
            // the server for real (signature-verified) confirmation.
            fetch('/payments/razorpay/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: [
                `_csrf=${encodeURIComponent(csrfToken)}`,
                `razorpay_order_id=${encodeURIComponent(response.razorpay_order_id)}`,
                `razorpay_payment_id=${encodeURIComponent(response.razorpay_payment_id)}`,
                `razorpay_signature=${encodeURIComponent(response.razorpay_signature)}`,
              ].join('&'),
            })
              .then(function (verifyResponse) {
                return verifyResponse.json().then(function (data) {
                  return { ok: verifyResponse.ok, data: data };
                });
              })
              .then(function (verifyResult) {
                if (verifyResult.ok && verifyResult.data.success) {
                  window.location.href = `/payment/success/${order.orderId}`;
                } else {
                  window.location.href = `/payment/failed/${order.orderId}`;
                }
              })
              .catch(function () {
                window.location.href = `/payment/failed/${order.orderId}`;
              });
          },
          modal: {
            // User closed the popup without paying — send them to the
            // failed/pending page rather than leaving them stranded. The
            // order itself is left PENDING (not marked FAILED) here, since
            // some payment methods can still complete after the popup
            // closes; the webhook is the source of truth for that.
            ondismiss: function () {
              setLoading(false);
              window.location.href = `/payment/failed/${order.orderId}`;
            },
          },
        };

        const razorpayCheckout = new Razorpay(options);
        razorpayCheckout.on('payment.failed', function () {
          window.location.href = `/payment/failed/${order.orderId}`;
        });
        razorpayCheckout.open();
        setLoading(false);
      })
      .catch(function (err) {
        setLoading(false);
        showError(err.message || 'Something went wrong. Please try again.');
      });
  });
})();
