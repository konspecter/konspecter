const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
/** Numbers only, the year in two digits: 12.11.26, 11/12/26. */
const shortFormat = new Intl.DateTimeFormat(undefined, {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
});
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

type NoteDateProps = {
  /** ISO 8601 timestamp. */
  value: string;
  /** Shows the time too, when the value has one. */
  withTime?: boolean;
  /** Numbers only, with a two-digit year: for a small space. */
  short?: boolean;
};

export function NoteDate({ value, withTime = false, short = false }: NoteDateProps) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const format = short
    ? shortFormat
    : withTime && value.includes("T")
      ? dateTimeFormat
      : dateFormat;
  return <time dateTime={value}>{format.format(date)}</time>;
}
