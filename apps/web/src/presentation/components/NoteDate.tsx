const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

type NoteDateProps = {
  /** ISO 8601 timestamp. */
  value: string;
};

export function NoteDate({ value }: NoteDateProps) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return <time dateTime={value}>{dateFormat.format(date)}</time>;
}
