use std::io;
use std::time::Duration;

use crossterm::cursor::SetCursorStyle;
use crossterm::event::{
    self, DisableBracketedPaste, EnableBracketedPaste, Event, KeyCode, KeyEventKind, KeyModifiers,
};
use crossterm::execute;
use crossterm::terminal::{
    EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode,
};
use forgeone_tui::{DashboardState, FocusPane, render_dashboard};
use ratatui::Terminal;
use ratatui::backend::CrosstermBackend;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut terminal = setup_terminal()?;
    let result = run_app(&mut terminal);
    restore_terminal(&mut terminal)?;
    result
}

fn run_app(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut state = DashboardState::mock();

    loop {
        terminal.draw(|frame| render_dashboard(frame, &state))?;

        if !event::poll(Duration::from_millis(100))? {
            continue;
        }

        match event::read()? {
            Event::Paste(text) => {
                if state.focus == FocusPane::Input {
                    state.cancel_exit();
                    state.record_paste(text.as_str());
                }
            }
            Event::Key(key) => {
                if key.kind != KeyEventKind::Press {
                    continue;
                }

                match key.code {
                    KeyCode::Tab => state.cycle_focus(),
                    KeyCode::Up => {
                        state.cancel_exit();
                    }
                    KeyCode::Down => {
                        state.cancel_exit();
                    }
                    KeyCode::Left => {
                        state.cancel_exit();
                        if state.focus == FocusPane::Input {
                            state.move_cursor_left();
                        }
                    }
                    KeyCode::Right => {
                        state.cancel_exit();
                        if state.focus == FocusPane::Input {
                            state.move_cursor_right();
                        }
                    }
                    KeyCode::Home => {
                        state.cancel_exit();
                        if state.focus == FocusPane::Input {
                            state.move_cursor_home();
                        }
                    }
                    KeyCode::End => {
                        state.cancel_exit();
                        if state.focus == FocusPane::Input {
                            state.move_cursor_end();
                        }
                    }
                    KeyCode::Backspace => {
                        state.cancel_exit();
                        if state.focus == FocusPane::Input {
                            state.backspace();
                        }
                    }
                    KeyCode::Delete => {
                        state.cancel_exit();
                        if state.focus == FocusPane::Input {
                            state.delete_forward();
                        }
                    }
                    KeyCode::Esc => {
                        if state.exit_pending {
                            state.cancel_exit();
                        } else if state.focus == FocusPane::Input {
                            state.clear_input();
                        }
                    }
                    KeyCode::Enter => {
                        state.cancel_exit();
                        if state.focus == FocusPane::Input && !state.input.is_empty() {
                            state.hint = format!("已提交: {}", state.input);
                            state.clear_input();
                        }
                    }
                    KeyCode::Char(ch) => {
                        if key.modifiers.contains(KeyModifiers::CONTROL) && (ch == 'c' || ch == 'C')
                        {
                            if state.exit_pending {
                                return Ok(());
                            }
                            state.arm_exit();
                        } else {
                            state.cancel_exit();
                            if state.focus == FocusPane::Input {
                                state.append_char(ch);
                            }
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
}

fn setup_terminal() -> Result<Terminal<CrosstermBackend<io::Stdout>>, Box<dyn std::error::Error>> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(
        stdout,
        EnterAlternateScreen,
        EnableBracketedPaste,
        SetCursorStyle::SteadyBar
    )?;
    let backend = CrosstermBackend::new(stdout);
    let terminal = Terminal::new(backend)?;
    Ok(terminal)
}

fn restore_terminal(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
) -> Result<(), Box<dyn std::error::Error>> {
    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        DisableBracketedPaste,
        SetCursorStyle::DefaultUserShape,
        LeaveAlternateScreen
    )?;
    terminal.show_cursor()?;
    Ok(())
}
