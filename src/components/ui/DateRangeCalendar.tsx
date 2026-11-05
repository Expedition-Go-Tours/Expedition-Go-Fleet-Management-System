"use client";

import { DayPicker, type DateRange } from "@daypicker/react";
import { enGB } from "@daypicker/react/locale";

/**
 * Themed range calendar. Visual rules live in `globals.css` under the
 * `.egt-date-range` scope so DayPicker's structural class hooks can be styled
 * with the product tokens without importing its opinionated stylesheet.
 *
 * Selection itself is owned by the caller: the picker keeps a booking-style
 * anchor day so a first click starts a new range and the second click closes it.
 */
export function DateRangeCalendar({
  selected,
  onSelect,
  defaultMonth,
  numberOfMonths = 1,
}: {
  selected: DateRange | undefined;
  onSelect: (range: DateRange | undefined, triggerDate: Date) => void;
  defaultMonth?: Date;
  numberOfMonths?: 1 | 2;
}) {
  return (
    <DayPicker
      mode="range"
      required={false}
      selected={selected}
      onSelect={onSelect}
      defaultMonth={defaultMonth}
      numberOfMonths={numberOfMonths}
      locale={enGB}
      weekStartsOn={1}
      fixedWeeks
      showOutsideDays
      navLayout="around"
      className="egt-date-range"
    />
  );
}
