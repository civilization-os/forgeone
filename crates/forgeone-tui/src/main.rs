use forgeone_tui::{DashboardState, launch_tui, load_dashboard, render_dashboard};
use std::env;
use std::process;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    if let Some(flag) = args.next() {
        if flag == "--dump" {
            let mut session_id = None;
            let mut width = 120;
            let mut height = 30;

            if let Some(arg) = args.next() {
                if let Ok(w) = arg.parse::<u16>() {
                    width = w;
                    if let Some(h_arg) = args.next() {
                        if let Ok(h) = h_arg.parse::<u16>() {
                            height = h;
                        }
                    }
                } else {
                    session_id = Some(arg);
                    if let Some(w_arg) = args.next() {
                        if let Ok(w) = w_arg.parse::<u16>() {
                            width = w;
                        }
                    }
                    if let Some(h_arg) = args.next() {
                        if let Ok(h) = h_arg.parse::<u16>() {
                            height = h;
                        }
                    }
                }
            }
            dump_session_ui(session_id.as_deref(), width, height)?;
            return Ok(());
        } else if flag == "--help" || flag == "-h" {
            println!(
                "usage:\n  forgeone-tui [session_id]\n  forgeone-tui --dump [session_id] [width] [height]"
            );
            process::exit(0);
        } else {
            // It is a session_id
            return launch_tui(Some(&flag));
        }
    }

    launch_tui(None)
}

fn dump_session_ui(
    session_id: Option<&str>,
    width: u16,
    height: u16,
) -> Result<(), Box<dyn std::error::Error>> {
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;

    let backend = TestBackend::new(width, height);
    let mut terminal = Terminal::new(backend)?;
    let state = load_dashboard(session_id).unwrap_or_else(|error| {
        DashboardState::empty(format!("failed to load runtime view: {error}"))
    });
    terminal.draw(|frame| render_dashboard(frame, &state))?;
    let buffer = terminal.backend().buffer();
    for y in 0..buffer.area.height {
        let mut line = String::new();
        for x in 0..buffer.area.width {
            let cell = &buffer[(x, y)];
            line.push_str(cell.symbol());
        }
        println!("{}", line);
    }
    Ok(())
}
