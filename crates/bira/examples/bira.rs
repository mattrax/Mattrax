use bira::Builder;

#[derive(Debug, Builder)]
pub struct Demo {
    a: String,
    c: i32,
    b: Option<String>,
    e: Option<bool>,
}

fn main() {
    let demo: Demo = Demo::builder("a".into(), 42).b("b".into()).build();
    println!("{:?}", demo);
}
