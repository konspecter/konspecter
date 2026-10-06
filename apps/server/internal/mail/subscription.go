package mail

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// The emails about paid sync: one for every billing event. Each
// links to the subscription on the site's settings page and says that the
// notes are safe whatever happens to the subscription.

// Charge is a payment, or a price, an email tells of.
type Charge struct {
	// Amount is as the gateway wrote it ("299.00").
	Amount   string
	Currency string
	// Period is the subscription's period, {N}{d|w|m|q|y} ("1m").
	Period string
	// Until is when the paid time ends, or the next charge.
	Until time.Time
}

func subscriptionLetter(locale Locale, siteURL string) letter {
	l := letter{locale: locale, siteURL: siteURL, account: true}
	label := "Open subscription settings"
	if locale == Russian {
		label = "Открыть настройки подписки"
	}
	l.link = &button{URL: siteURL + "/settings#subscription", Label: label}
	return l
}

func notesKept(locale Locale) string {
	if locale == Russian {
		return "Ваши конспекты никуда не денутся: они остаются на ваших устройствах и на сервере."
	}
	return "Your conspects are safe: they stay on your devices and on the server."
}

// TrialStarted: the free trial of sync began with the account's first sync.
func TrialStarted(locale Locale, siteURL, to string, until time.Time) Message {
	l := subscriptionLetter(locale, siteURL)
	if locale == Russian {
		l.subject = "Пробный период синхронизации Konspecter начался"
		l.title = "Пробный период начался"
		l.intro = []string{fmt.Sprintf("Синхронизация бесплатна до %s. Потом её можно оформить по подписке.", date(locale, until))}
		l.outro = []string{"Если вы не оформите подписку, синхронизация приостановится, а конспекты останутся на месте."}
	} else {
		l.subject = "Your Konspecter sync trial has started"
		l.title = "Your trial has started"
		l.intro = []string{fmt.Sprintf("Sync is free until %s. After that, it takes a subscription.", date(locale, until))}
		l.outro = []string{"If you do not subscribe, sync pauses and your conspects stay where they are."}
	}
	return l.message(to)
}

// TrialEnded: the trial is over and sync paused.
func TrialEnded(locale Locale, siteURL, to string) Message {
	l := subscriptionLetter(locale, siteURL)
	if locale == Russian {
		l.subject = "Пробный период синхронизации Konspecter закончился"
		l.title = "Пробный период закончился"
		l.intro = []string{"Синхронизация приостановлена. Чтобы продолжить, оформите подписку."}
	} else {
		l.subject = "Your Konspecter sync trial has ended"
		l.title = "Your trial has ended"
		l.intro = []string{"Sync is paused. Subscribe to carry on."}
	}
	l.outro = []string{notesKept(locale)}
	return l.message(to)
}

// Subscribed: the first payment of a subscription went through.
func Subscribed(locale Locale, siteURL, to string, c Charge) Message {
	l := subscriptionLetter(locale, siteURL)
	if locale == Russian {
		l.subject = "Подписка на синхронизацию Konspecter оформлена"
		l.title = "Подписка оформлена"
		l.intro = []string{
			fmt.Sprintf("Оплата %s прошла. Синхронизация оплачена до %s.", money(locale, c.Amount, c.Currency), date(locale, c.Until)),
			fmt.Sprintf("Подписка продлевается автоматически раз в %s. Отменить её можно в любой момент в настройках.", period(locale, c.Period)),
		}
	} else {
		l.subject = "You have subscribed to Konspecter sync"
		l.title = "Thank you for subscribing"
		l.intro = []string{
			fmt.Sprintf("We received %s. Sync is paid until %s.", money(locale, c.Amount, c.Currency), date(locale, c.Until)),
			fmt.Sprintf("The subscription renews automatically every %s. You can cancel it any time in the settings.", period(locale, c.Period)),
		}
	}
	return l.message(to)
}

// Renewed: a renewal payment went through.
func Renewed(locale Locale, siteURL, to string, c Charge) Message {
	l := subscriptionLetter(locale, siteURL)
	if locale == Russian {
		l.subject = "Подписка на синхронизацию Konspecter продлена"
		l.title = "Подписка продлена"
		l.intro = []string{fmt.Sprintf("Оплата %s прошла. Синхронизация оплачена до %s.", money(locale, c.Amount, c.Currency), date(locale, c.Until))}
	} else {
		l.subject = "Your Konspecter sync subscription has renewed"
		l.title = "Subscription renewed"
		l.intro = []string{fmt.Sprintf("We received %s. Sync is paid until %s.", money(locale, c.Amount, c.Currency), date(locale, c.Until))}
	}
	return l.message(to)
}

// PaymentFailed: a renewal could not be charged. c.Until is when sync
// pauses if no payment goes through by then.
func PaymentFailed(locale Locale, siteURL, to string, c Charge) Message {
	l := subscriptionLetter(locale, siteURL)
	if locale == Russian {
		l.subject = "Не удалось продлить подписку Konspecter"
		l.title = "Оплата не прошла"
		l.intro = []string{
			fmt.Sprintf("Не удалось списать %s за синхронизацию. Мы попробуем ещё раз.", money(locale, c.Amount, c.Currency)),
			fmt.Sprintf("Синхронизация работает до %s. Проверьте карту или оформите подписку заново.", date(locale, c.Until)),
		}
	} else {
		l.subject = "We could not renew your Konspecter subscription"
		l.title = "Payment failed"
		l.intro = []string{
			fmt.Sprintf("We could not charge %s for sync. We will try again.", money(locale, c.Amount, c.Currency)),
			fmt.Sprintf("Sync keeps working until %s. Check your card, or subscribe again.", date(locale, c.Until)),
		}
	}
	l.outro = []string{notesKept(locale)}
	return l.message(to)
}

// Canceled: the subscription will not renew. until is the end of the paid
// time (zero: none left).
func Canceled(locale Locale, siteURL, to string, until time.Time) Message {
	l := subscriptionLetter(locale, siteURL)
	if locale == Russian {
		l.subject = "Подписка на синхронизацию Konspecter отменена"
		l.title = "Подписка отменена"
		l.intro = []string{"Подписка больше не будет продлеваться, и деньги больше не спишутся."}
		if !until.IsZero() {
			l.intro = append(l.intro, fmt.Sprintf("Синхронизация работает до %s.", date(locale, until)))
		}
	} else {
		l.subject = "Your Konspecter sync subscription is cancelled"
		l.title = "Subscription cancelled"
		l.intro = []string{"The subscription will not renew, and you will not be charged again."}
		if !until.IsZero() {
			l.intro = append(l.intro, fmt.Sprintf("Sync keeps working until %s.", date(locale, until)))
		}
	}
	l.outro = []string{notesKept(locale)}
	return l.message(to)
}

// Resumed: a cancelled subscription renews again; c.Until is the next charge.
func Resumed(locale Locale, siteURL, to string, c Charge) Message {
	l := subscriptionLetter(locale, siteURL)
	if locale == Russian {
		l.subject = "Подписка на синхронизацию Konspecter возобновлена"
		l.title = "Подписка возобновлена"
		l.intro = []string{fmt.Sprintf("Подписка снова продлевается автоматически. Следующее списание — %s, %s.",
			money(locale, c.Amount, c.Currency), date(locale, c.Until))}
	} else {
		l.subject = "Your Konspecter sync subscription has resumed"
		l.title = "Subscription resumed"
		l.intro = []string{fmt.Sprintf("The subscription renews automatically again. The next charge is %s on %s.",
			money(locale, c.Amount, c.Currency), date(locale, c.Until))}
	}
	return l.message(to)
}

// GraceStarted: the paid time is over; sync keeps working until until.
func GraceStarted(locale Locale, siteURL, to string, until time.Time) Message {
	l := subscriptionLetter(locale, siteURL)
	if locale == Russian {
		l.subject = "Оплаченное время синхронизации Konspecter закончилось"
		l.title = "Оплаченное время закончилось"
		l.intro = []string{fmt.Sprintf("Мы оставили синхронизацию включённой до %s бесплатно. Чтобы она не остановилась, оформите подписку.", date(locale, until))}
	} else {
		l.subject = "Your paid Konspecter sync time is over"
		l.title = "Your paid time is over"
		l.intro = []string{fmt.Sprintf("We keep sync on for free until %s. Subscribe so that it does not pause.", date(locale, until))}
	}
	l.outro = []string{notesKept(locale)}
	return l.message(to)
}

// Paused: the account's time ran out and sync paused.
func Paused(locale Locale, siteURL, to string) Message {
	l := subscriptionLetter(locale, siteURL)
	if locale == Russian {
		l.subject = "Синхронизация Konspecter приостановлена"
		l.title = "Синхронизация приостановлена"
		l.intro = []string{"Оплаченное время закончилось. Оформите подписку, и синхронизация продолжится с того же места."}
	} else {
		l.subject = "Konspecter sync is paused"
		l.title = "Sync is paused"
		l.intro = []string{"Your paid time is over. Subscribe, and sync carries on where it stopped."}
	}
	l.outro = []string{notesKept(locale)}
	return l.message(to)
}

// Refunded: a payment was returned.
func Refunded(locale Locale, siteURL, to string, c Charge) Message {
	l := subscriptionLetter(locale, siteURL)
	if locale == Russian {
		l.subject = "Возврат платежа Konspecter"
		l.title = "Платёж возвращён"
		l.intro = []string{fmt.Sprintf("Мы вернули %s. Деньги придут туда, откуда была оплата, обычно в течение нескольких дней.", money(locale, c.Amount, c.Currency))}
	} else {
		l.subject = "Your Konspecter payment was refunded"
		l.title = "Payment refunded"
		l.intro = []string{fmt.Sprintf("We refunded %s. It goes back to where you paid from, usually within a few days.", money(locale, c.Amount, c.Currency))}
	}
	return l.message(to)
}

var russianMonths = [...]string{
	"января", "февраля", "марта", "апреля", "мая", "июня",
	"июля", "августа", "сентября", "октября", "ноября", "декабря",
}

// date writes a day: "6 October 2026", "6 октября 2026 г." (UTC).
func date(locale Locale, t time.Time) string {
	t = t.UTC()
	if locale == Russian {
		return fmt.Sprintf("%d %s %d г.", t.Day(), russianMonths[t.Month()-1], t.Year())
	}
	return t.Format("2 January 2006")
}

// money writes an amount: "299 ₽", "$3", "3.50 EUR".
func money(locale Locale, amount, currency string) string {
	amount = strings.TrimSuffix(amount, ".00")
	switch currency {
	case "RUB":
		return amount + " ₽"
	case "USD":
		return "$" + amount
	case "EUR":
		if locale == Russian {
			return amount + " €"
		}
		return "€" + amount
	}
	return amount + " " + currency
}

// period writes how often a subscription renews: "month", "3 months";
// in Russian after "раз в": "месяц", "3 месяца".
func period(locale Locale, value string) string {
	if value == "" {
		return ""
	}
	count, err := strconv.Atoi(value[:len(value)-1])
	if err != nil {
		return value
	}
	unit := value[len(value)-1]
	if locale == Russian {
		forms := map[byte][3]string{
			'd': {"день", "дня", "дней"}, 'w': {"неделю", "недели", "недель"}, 'm': {"месяц", "месяца", "месяцев"},
			'q': {"квартал", "квартала", "кварталов"}, 'y': {"год", "года", "лет"},
		}[unit]
		if count == 1 {
			return forms[0]
		}
		return fmt.Sprintf("%d %s", count, forms[russianPlural(count)])
	}
	name := map[byte]string{'d': "day", 'w': "week", 'm': "month", 'q': "quarter", 'y': "year"}[unit]
	if count == 1 {
		return name
	}
	return fmt.Sprintf("%d %ss", count, name)
}

// russianPlural picks the form for a count: 0 for 1, 21; 1 for 2–4; 2 for 5–20.
func russianPlural(n int) int {
	switch {
	case n%10 == 1 && n%100 != 11:
		return 0
	case n%10 >= 2 && n%10 <= 4 && (n%100 < 10 || n%100 >= 20):
		return 1
	}
	return 2
}

// Notice is a billing event the billing service has the server email: its
// kind, and what its email tells.
type Notice struct {
	Kind     string
	Amount   string
	Currency string
	// Period is the subscription's, {N}{d|w|m|q|y} ("1m").
	Period string
	// Until is when the paid time ends, or the next charge.
	Until *time.Time
}

// NoticeKinds are the kinds of billing events there is an email for.
var NoticeKinds = []string{
	"trial_started", "trial_ended", "subscribed", "renewed", "payment_failed",
	"canceled", "resumed", "grace_started", "paused", "refunded",
}

// BillingNotice is the email that tells of a billing event; false for a
// kind it does not know.
func BillingNotice(locale Locale, siteURL, to string, n Notice) (Message, bool) {
	var until time.Time
	if n.Until != nil {
		until = *n.Until
	}
	charge := Charge{Amount: n.Amount, Currency: n.Currency, Period: n.Period, Until: until}
	switch n.Kind {
	case "trial_started":
		return TrialStarted(locale, siteURL, to, until), true
	case "trial_ended":
		return TrialEnded(locale, siteURL, to), true
	case "subscribed":
		return Subscribed(locale, siteURL, to, charge), true
	case "renewed":
		return Renewed(locale, siteURL, to, charge), true
	case "payment_failed":
		return PaymentFailed(locale, siteURL, to, charge), true
	case "canceled":
		return Canceled(locale, siteURL, to, until), true
	case "resumed":
		return Resumed(locale, siteURL, to, charge), true
	case "grace_started":
		return GraceStarted(locale, siteURL, to, until), true
	case "paused":
		return Paused(locale, siteURL, to), true
	case "refunded":
		return Refunded(locale, siteURL, to, charge), true
	}
	return Message{}, false
}
