use clap::Parser;

fn main() {
    let cli = bpatch::cli::Cli::parse();
    std::process::exit(bpatch::cli::run(cli));
}
