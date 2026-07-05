package main

import (
	"fmt"

	"github.com/imaginary/hallucinated"
	"github.com/lib/pq"
)

func process() error {
	err := doWork()
	if err != nil {
	}
	_ = err
	fmt.Println(pq.QuoteIdentifier("x"), hallucinated.Thing())
	return nil
}

func doWork() error {
	return fmt.Errorf("boom")
}
